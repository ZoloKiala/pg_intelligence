// Package indicators ports the hotspot/indicator normalization, categorization,
// and district/country mapping logic from the original Django views.py. These
// are pure functions over strings; the DB-dependent aggregations live in the
// store/server packages and call into here.
package indicators

import (
	"regexp"
	"sort"
	"strings"
)

var categoryRE = regexp.MustCompile(`(?i)(older|younger|young)_(men|women)`)

var indicatorTypoFixes = map[string]string{
	"permamnent":  "permanent",
	"permenent":   "permanent",
	"permanant":   "permanent",
	"permaent":    "permanent",
	"seassonal":   "seasonal",
	"seasonsl":    "seasonal",
	"confict":     "conflict",
	"nutirent":    "nutrient",
	"fertilty":    "fertility",
	"grazzing":    "grazing",
	"grazery":     "grazing",
	"gulley":      "gully",
	"agricultue":  "agriculture",
}

var indicatorTokenSingular = map[string]string{
	"conflicts": "conflict",
	"disputes":  "dispute",
	"corridors": "corridor",
	"wetlands":  "wetland",
	"rivers":    "river",
	"yields":    "yield",
}

// HiddenIndicators are dropped from option lists and counts.
var HiddenIndicators = map[string]bool{"priority": true, "spring": true}

// InterventionAreaItems is the fixed ordered list for that category group.
var InterventionAreaItems = []string{
	"contour bund",
	"cb plus",
	"cb minus",
	"d plus",
	"d minus",
	"dam",
}

// CategoryOrder is the display order of indicator categories.
var CategoryOrder = []string{
	"Hydrological and Water Stress Hotspots",
	"Soil Related Hotspots",
	"Crop and Productivity Hotspots",
	"Land Use and Ecological Hotspots",
	"Socio-economic Hotspots",
	"Intervention Areas",
}

var categoryKeys = map[string]string{
	"Hydrological and Water Stress Hotspots": "water",
	"Soil Related Hotspots":                  "soil",
	"Crop and Productivity Hotspots":          "productivity",
	"Land Use and Ecological Hotspots":        "ecosystem",
	"Socio-economic Hotspots":                 "governance",
	"Intervention Areas":                      "other",
}

// CategoryKey returns the short css-friendly key for a category name.
func CategoryKey(name string) string {
	if k, ok := categoryKeys[name]; ok {
		return k
	}
	return "other"
}

var districtNameAliases = map[string]string{
	"mongochi": "mangochi",
}

// DistrictCountry maps a district to its country.
var DistrictCountry = map[string]string{
	"Chikwawa":      "Malawi",
	"Lilongwe":      "Malawi",
	"Mangochi":      "Malawi",
	"Mchinji":       "Malawi",
	"Mulanje":       "Malawi",
	"Salima":        "Malawi",
	"Chibombo":      "Zambia",
	"Chipata":       "Zambia",
	"Kapiri Mposhi": "Zambia",
	"Kasenengwa":    "Zambia",
	"Monze":         "Zambia",
	"Mpongwe":       "Zambia",
	"Mumbwa":        "Zambia",
	"Petauke":       "Zambia",
	"Shibuyunji":    "Zambia",
}

// CountriesOrder is the display order of countries.
var CountriesOrder = []string{"Malawi", "Zambia"}

// CountryForDistrict returns the country a district belongs to, or "".
func CountryForDistrict(district string) string {
	return DistrictCountry[strings.TrimSpace(district)]
}

// DistrictsForCountry returns districts mapped to the given country (all if "").
func DistrictsForCountry(country string) []string {
	var out []string
	if country == "" {
		for d := range DistrictCountry {
			out = append(out, d)
		}
		return out
	}
	for d, mapped := range DistrictCountry {
		if mapped == country {
			out = append(out, d)
		}
	}
	return out
}

var categorySourceFileAliases = map[string][]string{
	"Older_Men":     {"Older_Men", "Men_Older_Than_40"},
	"Older_Women":   {"Older_Women", "Women_Older_Than_40"},
	"Younger_Men":   {"Younger_Men", "Young_Men", "Men_Less_Than_40"},
	"Younger_Women": {"Younger_Women", "Young_Women", "Women_Less_Than_40"},
}

var categorySourceFilePatterns = func() map[string][]*regexp.Regexp {
	m := make(map[string][]*regexp.Regexp)
	for category, aliases := range categorySourceFileAliases {
		var pats []*regexp.Regexp
		for _, alias := range aliases {
			pats = append(pats, regexp.MustCompile(`(^|[/_])`+regexp.QuoteMeta(strings.ToLower(alias))+`([/_.]|$)`))
		}
		m[category] = pats
	}
	return m
}()

// NormalizeDistrictName lowercases, collapses whitespace, and applies aliases.
func NormalizeDistrictName(value string) string {
	normalized := collapseSpaces(strings.ToLower(strings.TrimSpace(value)))
	if alias, ok := districtNameAliases[normalized]; ok {
		return alias
	}
	return normalized
}

// ParticipantCategoryFromSourceFile infers the participant group from a path.
func ParticipantCategoryFromSourceFile(sourceFile string) string {
	value := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(sourceFile, "-", "_"), " ", "_"))
	if value == "" {
		return ""
	}
	for category, pats := range categorySourceFilePatterns {
		for _, p := range pats {
			if p.MatchString(value) {
				return category
			}
		}
	}
	if m := categoryRE.FindString(sourceFile); m != "" {
		return NormalizeCategory(m)
	}
	return ""
}

// NormalizeCategory canonicalizes a participant category label.
func NormalizeCategory(value string) string {
	normalized := strings.ReplaceAll(strings.TrimSpace(value), " ", "_")
	lower := strings.ToLower(normalized)
	if lower == "young_men" {
		return "Younger_Men"
	}
	if lower == "young_women" {
		return "Younger_Women"
	}
	m := categoryRE.FindStringSubmatch(normalized)
	if m == nil {
		return normalized
	}
	age, gender := m[1], m[2]
	if strings.ToLower(age) == "young" {
		age = "Younger"
	} else {
		age = capitalize(age)
	}
	return age + "_" + capitalize(gender)
}

// CategoryTokensForFilter returns the source-file aliases for a category.
func CategoryTokensForFilter(category string) []string {
	normalized := NormalizeCategory(category)
	if aliases, ok := categorySourceFileAliases[normalized]; ok {
		return aliases
	}
	return []string{normalized}
}

// FormatCategoryLabel turns "Older_Men" into "Older men".
func FormatCategoryLabel(category string) string {
	label := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(category, "_", " ")))
	if label == "" {
		return ""
	}
	return capitalize(label)
}

// NormalizeIndicator canonicalizes a raw indicator string. Ported faithfully
// (including ordering) from the Django _normalize_indicator.
func NormalizeIndicator(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return ""
	}

	normalized = strings.ReplaceAll(normalized, "-", " ")
	normalized = strings.ReplaceAll(normalized, "_", " ")
	normalized = collapseSpaces(normalized)

	words := strings.Split(normalized, " ")
	for i, token := range words {
		if fix, ok := indicatorTypoFixes[token]; ok {
			words[i] = fix
		}
	}
	normalized = strings.Join(words, " ")

	replacements := [][2]string{
		{"wild life", "wildlife"},
		{"river bank", "riverbank"},
		{"bore hole", "borehole"},
		{"good condition contour bund", "cb plus"},
		{"bad condition contour bund", "cb minus"},
		{"good contour bund", "cb plus"},
		{"bad contour bund", "cb minus"},
		{"good condition dam", "d plus"},
		{"bad condition dam", "d minus"},
		{"priority dam", "dam"},
		{"forest decline", "forest loss"},
		{"pollinator habitats", "pollinators"},
		{"pollinator habitat", "pollinators"},
		{"pollinator habitat losses", "pollinators"},
		{"pollinator habitat loss", "pollinators"},
	}
	for _, r := range replacements {
		normalized = strings.ReplaceAll(normalized, r[0], r[1])
	}

	switch normalized {
	case "seasonal forest", "forest seasonal", "deforestation sacred forest",
		"sacred forest reduction", "sacred forests":
		normalized = "sacred forest"
	}
	switch normalized {
	case "yield", "yields", "yield decline", "yield loss":
		normalized = "yield loss"
	}

	normalized = strings.ReplaceAll(normalized, "nutrient loss areas", "nutrient loss")
	normalized = strings.ReplaceAll(normalized, "nutrient loss area", "nutrient loss")
	normalized = strings.ReplaceAll(normalized, "riverbank collapsed", "riverbank collapse")
	normalized = strings.ReplaceAll(normalized, "stream seasonal", "seasonal stream")
	normalized = strings.ReplaceAll(normalized, "stream permanent", "permanent stream")
	normalized = strings.ReplaceAll(normalized, "spring permanent", "permanent spring")

	switch normalized {
	case "women barriers", "women barriers to accessing land water and grazing sites":
		normalized = "women barriers to accessing land water and grazing sites"
	}
	switch normalized {
	case "water conflict", "water conflicts", "water conflict area":
		normalized = "water conflict area"
	}
	if normalized == "flooding" {
		normalized = "flood"
	}
	if normalized == "women barriers to accessing land water and grazing sites" {
		return normalized
	}
	if strings.Contains(normalized, "grazing") {
		return "grazing pressure (high)"
	}

	parts := strings.Split(normalized, " ")
	if len(parts) > 0 {
		last := parts[len(parts)-1]
		if singular, ok := indicatorTokenSingular[last]; ok {
			parts[len(parts)-1] = singular
		}
	}
	return strings.Join(parts, " ")
}

// IndicatorCategory classifies a normalized indicator into a category name.
func IndicatorCategory(indicator string) string {
	value := strings.ToLower(indicator)
	if value == "" {
		return "Intervention Areas"
	}
	if containsAny(value, "priority", "women barriers",
		"women barriers to accessing land water and grazing sites", "land tenure") {
		return "Socio-economic Hotspots"
	}
	if containsAny(value, "contour bund", "contour bunds", "terrace", "terraces",
		"ridge", "ridges", "dam") {
		return "Intervention Areas"
	}
	if containsAny(value, "borehole", "river", "wetland", "stream", "water", "dam",
		"lake", "run off", "flood", "irrigation", "spring", "shallow well",
		"illegal abstraction") {
		return "Hydrological and Water Stress Hotspots"
	}
	if containsAny(value, "erosion", "gully", "sedimentation", "terraces", "ridges") {
		return "Soil Related Hotspots"
	}
	if containsAny(value, "yield", "fertility", "nutrient") {
		return "Crop and Productivity Hotspots"
	}
	if containsAny(value, "forest", "reforestation", "wildlife", "pollinators",
		"riparian", "deforestation") {
		return "Land Use and Ecological Hotspots"
	}
	if containsAny(value, "grazing", "pasture") {
		return "Crop and Productivity Hotspots"
	}
	return "Intervention Areas"
}

// --- helpers ---

func collapseSpaces(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func capitalize(s string) string {
	if s == "" {
		return ""
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

// SortedKeys returns the keys of a set, sorted.
func SortedKeys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
