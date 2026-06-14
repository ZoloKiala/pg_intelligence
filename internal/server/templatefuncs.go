package server

import (
	"html/template"
	"strings"
)

// indicatorSpecialLabels mirrors the if/elif label chain in the Django
// dashboard template.
var indicatorSpecialLabels = map[string]string{
	"land tenure":             "Land tenure issues",
	"pollinators":             "Pollinator habitat loss",
	"grazing pressure (high)": "High Grazing Pressure",
	"contour bund":            "Contour Bund (CB)",
	"cb plus":                 "CB+ (Contour Bund in Good Condition)",
	"cb minus":                "CB- (Contour Bund in Bad Condition)",
	"dam":                     "High potential damming point",
	"d plus":                  "D+ (Dam in Good Condition)",
	"d minus":                 "D- (Dam in Bad Condition)",
	"women barriers to accessing land water and grazing sites": "Women barriers to accessing land, water, and grazing sites",
}

// indicatorLabel returns the display label for an indicator key, falling back
// to capfirst (and "(blank)" for empty values, matching the counts list).
func indicatorLabel(s string) string {
	if v, ok := indicatorSpecialLabels[s]; ok {
		return v
	}
	if s == "" {
		return "(blank)"
	}
	return capfirst(s)
}

func capfirst(s string) string {
	if s == "" {
		return ""
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func has(list []string, value string) bool {
	for _, v := range list {
		if v == value {
			return true
		}
	}
	return false
}

func templateFuncs() template.FuncMap {
	return template.FuncMap{
		"indicatorLabel": indicatorLabel,
		"capfirst":       capfirst,
		"has":            has,
	}
}
