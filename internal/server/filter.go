package server

import (
	"net/url"
	"strconv"
	"strings"

	"pgis/internal/indicators"
	"pgis/internal/store"
)

// Filters captures the location query parameters that drive the dashboard and
// the API endpoints.
type Filters struct {
	Country     string
	District    string
	Indicators  []string
	Categories  []string
	Q           string
	Severity    string
	SeverityMin string
	SeverityMax string
}

// ParseFilters reads filters from query parameters.
func ParseFilters(q url.Values) Filters {
	f := Filters{
		Country:     strings.TrimSpace(q.Get("country")),
		District:    strings.TrimSpace(q.Get("district")),
		Q:           strings.TrimSpace(q.Get("q")),
		Severity:    strings.TrimSpace(q.Get("severity")),
		SeverityMin: strings.TrimSpace(q.Get("severity_min")),
		SeverityMax: strings.TrimSpace(q.Get("severity_max")),
	}
	for _, v := range q["indicator"] {
		if s := strings.TrimSpace(v); s != "" {
			f.Indicators = append(f.Indicators, s)
		}
	}
	for _, v := range q["category"] {
		if strings.TrimSpace(v) != "" {
			f.Categories = append(f.Categories, indicators.NormalizeCategory(v))
		}
	}
	return f
}

// Apply filters the location cache, mirroring the Django queryset filters.
func (d *Derived) Apply(locations []store.Location, f Filters) []store.Location {
	// country / district scoping
	var countryDistricts map[string]bool
	if f.Country != "" {
		countryDistricts = map[string]bool{}
		for _, dd := range indicators.DistrictsForCountry(f.Country) {
			countryDistricts[dd] = true
		}
	}
	district := f.District
	if district != "" && f.Country != "" && countryDistricts != nil && !countryDistricts[district] {
		// District doesn't belong to the chosen country — ignore it rather
		// than returning zero rows.
		district = ""
	}

	// expand selected indicators back to raw values
	var expanded map[string]bool
	if len(f.Indicators) > 0 {
		expanded = map[string]bool{}
		for _, sel := range f.Indicators {
			key := indicators.NormalizeIndicator(sel)
			if raws, ok := d.groups[key]; ok {
				for raw := range raws {
					expanded[raw] = true
				}
			} else if sel != "" {
				expanded[sel] = true
			}
		}
	}

	// category source-file tokens (lowercased substrings)
	var catTokens []string
	for _, cat := range f.Categories {
		for _, token := range indicators.CategoryTokensForFilter(cat) {
			lower := strings.ToLower(token)
			catTokens = append(catTokens, lower+"_", lower+".")
		}
	}

	sevExact, sevExactOK := 0, false
	if f.Severity == "1" || f.Severity == "3" || f.Severity == "5" {
		sevExact, _ = strconv.Atoi(f.Severity)
		sevExactOK = true
	}
	sevMin, sevMinOK := parseInt(f.SeverityMin)
	sevMax, sevMaxOK := parseInt(f.SeverityMax)

	q := strings.ToLower(f.Q)

	out := make([]store.Location, 0, len(locations))
	for _, loc := range locations {
		if countryDistricts != nil && !countryDistricts[loc.District] {
			continue
		}
		if district != "" && loc.District != district {
			continue
		}
		if expanded != nil && !expanded[loc.Indicator] {
			continue
		}
		if len(catTokens) > 0 && !matchesAnyToken(strings.ToLower(loc.SourceFile), catTokens) {
			continue
		}
		if q != "" && !(strings.Contains(strings.ToLower(loc.Label), q) ||
			strings.Contains(strings.ToLower(loc.Name), q) ||
			strings.Contains(strings.ToLower(loc.Indicator), q) ||
			strings.Contains(strings.ToLower(loc.District), q)) {
			continue
		}
		if sevExactOK {
			if loc.Severity == nil || *loc.Severity != sevExact {
				continue
			}
		} else {
			if sevMinOK && (loc.Severity == nil || *loc.Severity < sevMin) {
				continue
			}
			if sevMaxOK && (loc.Severity == nil || *loc.Severity > sevMax) {
				continue
			}
		}
		out = append(out, loc)
	}
	return out
}

func matchesAnyToken(s string, tokens []string) bool {
	for _, t := range tokens {
		if strings.Contains(s, t) {
			return true
		}
	}
	return false
}

func parseInt(s string) (int, bool) {
	if s == "" {
		return 0, false
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return 0, false
	}
	return v, true
}
