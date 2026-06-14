package server

import (
	"sort"

	"pgis/internal/indicators"
	"pgis/internal/store"
)

// IndicatorOptionGroup is a category group of indicator options for the form.
type IndicatorOptionGroup struct {
	Name  string
	Key   string
	Items []string
}

// CategoryOption is a participant-category filter option.
type CategoryOption struct {
	Value string
	Label string
}

// IndicatorCount is one row of the "top indicators" list.
type IndicatorCount struct {
	Indicator   string `json:"indicator"`
	Count       int    `json:"count"`
	Category    string `json:"category"`
	CategoryKey string `json:"category_key"`
	FilterQuery string `json:"-"`
}

// Derived holds aggregations computed once from the static location cache.
type Derived struct {
	// groups maps a normalized indicator key to the set of raw indicator
	// strings that normalize to it (used to expand a selection back to raw
	// values for filtering).
	groups map[string]map[string]bool

	IndicatorKeys        []string
	IndicatorOptionGroups []IndicatorOptionGroup
	Categories           []CategoryOption
	Districts            []string
}

// BuildDerived computes the derived aggregations from the location cache.
func BuildDerived(locations []store.Location) *Derived {
	d := &Derived{groups: map[string]map[string]bool{}}

	// indicator groups: normalized key -> set of raw values
	seenRaw := map[string]bool{}
	for _, loc := range locations {
		if loc.Indicator == "" || seenRaw[loc.Indicator] {
			continue
		}
		seenRaw[loc.Indicator] = true
		key := indicators.NormalizeIndicator(loc.Indicator)
		if key == "" || indicators.HiddenIndicators[key] {
			continue
		}
		if d.groups[key] == nil {
			d.groups[key] = map[string]bool{}
		}
		d.groups[key][loc.Indicator] = true
	}

	for key := range d.groups {
		d.IndicatorKeys = append(d.IndicatorKeys, key)
	}
	sort.Strings(d.IndicatorKeys)
	d.IndicatorOptionGroups = groupIndicatorsByCategory(d.IndicatorKeys)

	// available participant categories
	catSet := map[string]bool{}
	for _, loc := range locations {
		if loc.SourceFile == "" {
			continue
		}
		if cat := indicators.ParticipantCategoryFromSourceFile(loc.SourceFile); cat != "" {
			catSet[cat] = true
		}
	}
	for _, cat := range indicators.SortedKeys(catSet) {
		d.Categories = append(d.Categories, CategoryOption{
			Value: cat,
			Label: indicators.FormatCategoryLabel(cat),
		})
	}

	// distinct districts (already ordered by the cache's ORDER BY district)
	distSet := map[string]bool{}
	for _, loc := range locations {
		if !distSet[loc.District] {
			distSet[loc.District] = true
			d.Districts = append(d.Districts, loc.District)
		}
	}
	sort.Strings(d.Districts)

	return d
}

func groupIndicatorsByCategory(keys []string) []IndicatorOptionGroup {
	grouped := map[string][]string{}
	for _, cat := range indicators.CategoryOrder {
		grouped[cat] = []string{}
	}
	for _, ind := range keys {
		cat := indicators.IndicatorCategory(ind)
		grouped[cat] = append(grouped[cat], ind)
	}
	grouped["Intervention Areas"] = append([]string{}, indicators.InterventionAreaItems...)

	var out []IndicatorOptionGroup
	for _, cat := range indicators.CategoryOrder {
		if len(grouped[cat]) == 0 {
			continue
		}
		out = append(out, IndicatorOptionGroup{
			Name:  cat,
			Key:   indicators.CategoryKey(cat),
			Items: grouped[cat],
		})
	}
	return out
}

// canonicalIndicatorCounts counts normalized indicators over the given
// locations and returns the top `limit` rows.
func canonicalIndicatorCounts(locations []store.Location, limit int) []IndicatorCount {
	counter := map[string]int{}
	for _, loc := range locations {
		if loc.Indicator == "" {
			continue
		}
		key := indicators.NormalizeIndicator(loc.Indicator)
		if key == "" || indicators.HiddenIndicators[key] {
			continue
		}
		counter[key]++
	}

	type kv struct {
		key   string
		count int
	}
	pairs := make([]kv, 0, len(counter))
	for k, v := range counter {
		pairs = append(pairs, kv{k, v})
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].count != pairs[j].count {
			return pairs[i].count > pairs[j].count
		}
		return pairs[i].key < pairs[j].key
	})
	if len(pairs) > limit {
		pairs = pairs[:limit]
	}

	rows := make([]IndicatorCount, 0, len(pairs))
	for _, p := range pairs {
		cat := indicators.IndicatorCategory(p.key)
		rows = append(rows, IndicatorCount{
			Indicator:   p.key,
			Count:       p.count,
			Category:    cat,
			CategoryKey: indicators.CategoryKey(cat),
		})
	}
	return rows
}
