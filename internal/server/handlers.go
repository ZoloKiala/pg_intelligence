package server

import (
	"compress/gzip"
	"encoding/csv"
	"encoding/json"
	"html/template"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"pgis/internal/indicators"
)

// ---- dashboard ----

type districtOption struct {
	Value   string
	Country string
}

type currentFilters struct {
	Country     string
	District    string
	Indicator   string
	Indicators  []string
	Categories  []string
	Severity    string
	SeverityMin string
	SeverityMax string
	Q           string
}

type dashboardData struct {
	FilteredCount         int
	Countries             []string
	DistrictOptions       []districtOption
	IndicatorOptionGroups []IndicatorOptionGroup
	Categories            []CategoryOption
	IndicatorCounts       []IndicatorCount
	Current               currentFilters
	PGISJSON              template.JS
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	rawQuery := r.URL.Query()
	params := cloneValues(rawQuery)

	selectedCountry := strings.TrimSpace(params.Get("country"))
	selectedDistrict := strings.TrimSpace(params.Get("district"))

	// Drop a district that doesn't belong to the chosen country.
	if selectedCountry != "" && selectedDistrict != "" &&
		indicators.CountryForDistrict(selectedDistrict) != selectedCountry {
		selectedDistrict = ""
		params.Set("district", "")
	}

	// Default to Salima on a clean load.
	defaultSalima := ""
	for _, d := range s.derived.Districts {
		if strings.EqualFold(d, "salima") {
			defaultSalima = d
			break
		}
	}
	if len(rawQuery) == 0 && selectedCountry == "" && selectedDistrict == "" && defaultSalima != "" {
		selectedDistrict = defaultSalima
		params.Set("district", defaultSalima)
		selectedCountry = indicators.CountryForDistrict(defaultSalima)
		params.Set("country", selectedCountry)
	}

	filters := ParseFilters(params)
	filtered := s.derived.Apply(s.store.Locations(), filters)

	indicatorCounts := canonicalIndicatorCounts(filtered, 15)
	for i := range indicatorCounts {
		rp := cloneValues(params)
		rp["indicator"] = []string{indicatorCounts[i].Indicator}
		indicatorCounts[i].FilterQuery = rp.Encode()
	}

	// available countries (those that actually have districts present)
	var countries []string
	for _, c := range indicators.CountriesOrder {
		for _, d := range s.derived.Districts {
			if indicators.CountryForDistrict(d) == c {
				countries = append(countries, c)
				break
			}
		}
	}

	districtOptions := make([]districtOption, 0, len(s.derived.Districts))
	for _, d := range s.derived.Districts {
		districtOptions = append(districtOptions, districtOption{
			Value:   d,
			Country: indicators.CountryForDistrict(d),
		})
	}

	queryString := params.Encode()
	pgis, _ := json.Marshal(map[string]string{
		"locationsUrl":    "/api/locations.geojson?" + queryString,
		"districtsUrl":    "/api/districts.geojson?" + queryString,
		"indicatorApiUrl": "/api/selections?" + queryString,
	})

	cur := currentFilters{
		Country:     selectedCountry,
		District:    selectedDistrict,
		Severity:    params.Get("severity"),
		SeverityMin: params.Get("severity_min"),
		SeverityMax: params.Get("severity_max"),
		Q:           params.Get("q"),
	}
	if v := strings.TrimSpace(params.Get("indicator")); v != "" {
		cur.Indicator = indicators.NormalizeIndicator(v)
	}
	for _, v := range params["indicator"] {
		if strings.TrimSpace(v) != "" {
			cur.Indicators = append(cur.Indicators, indicators.NormalizeIndicator(v))
		}
	}
	for _, v := range params["category"] {
		if strings.TrimSpace(v) != "" {
			cur.Categories = append(cur.Categories, indicators.NormalizeCategory(v))
		}
	}

	data := dashboardData{
		FilteredCount:         len(filtered),
		Countries:             countries,
		DistrictOptions:       districtOptions,
		IndicatorOptionGroups: s.derived.IndicatorOptionGroups,
		Categories:            s.derived.Categories,
		IndicatorCounts:       indicatorCounts,
		Current:               cur,
		PGISJSON:              template.JS(pgis),
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := s.pages.ExecuteTemplate(w, "dashboard.html", data); err != nil {
		s.render500(w, err)
	}
}

// ---- locations.geojson ----

func (s *Server) locationsGeoJSON(w http.ResponseWriter, r *http.Request) {
	filtered := s.derived.Apply(s.store.Locations(), ParseFilters(r.URL.Query()))

	limit := 2500
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
		limit = v
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 5000 {
		limit = 5000
	}

	type geometry struct {
		Type        string    `json:"type"`
		Coordinates [2]float64 `json:"coordinates"`
	}
	type properties struct {
		ID         string `json:"id"`
		Name       string `json:"name"`
		Label      string `json:"label"`
		District   string `json:"district"`
		Indicator  string `json:"indicator"`
		Severity   *int   `json:"severity"`
		SourceFile string `json:"source_file"`
	}
	type feature struct {
		Type       string     `json:"type"`
		Geometry   geometry   `json:"geometry"`
		Properties properties `json:"properties"`
	}

	upper := len(filtered)
	if upper > limit {
		upper = limit
	}
	features := make([]feature, 0, upper)
	for _, loc := range filtered[:upper] {
		features = append(features, feature{
			Type:     "Feature",
			Geometry: geometry{Type: "Point", Coordinates: [2]float64{loc.Longitude, loc.Latitude}},
			Properties: properties{
				ID: loc.ExternalID, Name: loc.Name, Label: loc.Label,
				District: loc.District, Indicator: loc.Indicator,
				Severity: loc.Severity, SourceFile: loc.SourceFile,
			},
		})
	}

	writeJSON(w, map[string]any{
		"type":     "FeatureCollection",
		"count":    len(filtered),
		"returned": len(features),
		"features": features,
	})
}

// ---- districts.geojson ----

func (s *Server) districtBoundaries(w http.ResponseWriter, r *http.Request) {
	filtered := s.derived.Apply(s.store.Locations(), ParseFilters(r.URL.Query()))

	districtNames := map[string]bool{}
	for _, loc := range filtered {
		if loc.District == "" {
			continue
		}
		districtNames[indicators.NormalizeDistrictName(loc.District)] = true
	}

	source := s.boundaries.forCountry(strings.TrimSpace(r.URL.Query().Get("country")))

	features := make([]map[string]any, 0, len(source))
	matched := 0
	for _, f := range source {
		shapeName, _ := f.Properties["shapeName"].(string)
		key := indicators.NormalizeDistrictName(shapeName)
		isMatched := districtNames[key]
		if isMatched {
			matched++
		}
		props := map[string]any{}
		for k, v := range f.Properties {
			props[k] = v
		}
		props["district"] = shapeName
		props["district_key"] = key
		props["is_matched"] = isMatched
		features = append(features, map[string]any{
			"type":       "Feature",
			"properties": props,
			"geometry":   f.Geometry,
		})
	}

	writeJSON(w, map[string]any{
		"type":          "FeatureCollection",
		"count":         len(features),
		"matched_count": matched,
		"features":      features,
	})
}

// ---- indicators (summary) ----

func (s *Server) indicatorSummary(w http.ResponseWriter, r *http.Request) {
	filtered := s.derived.Apply(s.store.Locations(), ParseFilters(r.URL.Query()))

	counts := map[string]int{}
	for _, loc := range filtered {
		if loc.Indicator == "" {
			continue
		}
		counts[loc.Indicator]++
	}
	type row struct {
		Indicator string `json:"indicator"`
		Count     int    `json:"count"`
	}
	results := make([]row, 0, len(counts))
	for ind, c := range counts {
		results = append(results, row{ind, c})
	}
	sortByCountThenName(results, func(i int) (int, string) { return results[i].Count, results[i].Indicator })

	writeJSON(w, map[string]any{"results": results})
}

// ---- selections ----

func (s *Server) selectionResults(w http.ResponseWriter, r *http.Request) {
	district := strings.TrimSpace(r.URL.Query().Get("district"))
	results, err := s.store.SelectionResults(district)
	if err != nil {
		s.render500(w, err)
		return
	}
	writeJSON(w, map[string]any{"results": results})
}

func (s *Server) submitSelection(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		s.render500(w, err)
		return
	}
	indicator := strings.TrimSpace(r.PostForm.Get("indicator"))
	district := strings.TrimSpace(r.PostForm.Get("district"))
	rationale := strings.TrimSpace(r.PostForm.Get("rationale"))

	if indicator != "" {
		if err := s.store.AddSelection(indicator, district, rationale); err != nil {
			s.render500(w, err)
			return
		}
	}

	target := "/"
	if qs := r.PostForm.Get("query_string"); qs != "" {
		target = "/?" + qs
	}
	http.Redirect(w, r, target, http.StatusFound)
}

// ---- locations.csv ----

var csvFields = []string{
	"id", "country", "district", "indicator", "severity",
	"latitude", "longitude", "label", "source_file",
}

func (s *Server) locationsCSV(w http.ResponseWriter, r *http.Request) {
	filtered := s.derived.Apply(s.store.Locations(), ParseFilters(r.URL.Query()))

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="participatory_hotspots.csv"`)

	cw := csv.NewWriter(w)
	_ = cw.Write(csvFields)
	for _, loc := range filtered {
		severity := ""
		if loc.Severity != nil {
			severity = strconv.Itoa(*loc.Severity)
		}
		_ = cw.Write([]string{
			loc.ExternalID,
			indicators.DistrictCountry[loc.District],
			loc.District,
			loc.Indicator,
			severity,
			strconv.FormatFloat(loc.Latitude, 'f', -1, 64),
			strconv.FormatFloat(loc.Longitude, 'f', -1, 64),
			loc.Label,
			loc.SourceFile,
		})
	}
	cw.Flush()
}

// ---- api docs ----

type apiParam struct{ Name, Desc string }

type apiEndpoint struct {
	Method      string
	URL         string
	Title       string
	Description string
	Params      []apiParam
	Examples    []string
}

func (s *Server) apiDocs(w http.ResponseWriter, r *http.Request) {
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	base := scheme + "://" + r.Host

	endpoints := []apiEndpoint{
		{
			Method: "GET", URL: "/api/locations.geojson", Title: "Locations (GeoJSON)",
			Description: "All hotspot points as a GeoJSON FeatureCollection. Each feature has the point geometry and properties (id, district, indicator, severity, source_file).",
			Params: []apiParam{
				{"country", "Malawi or Zambia"},
				{"district", "District name, e.g. Salima, Mumbwa"},
				{"indicator", "Indicator key, e.g. flood, erosion, dam (repeatable)"},
				{"category", "Participant category: Older_Men, Older_Women, Younger_Men, Younger_Women (repeatable)"},
				{"severity", "Exact severity: 1, 3, or 5"},
				{"severity_min / severity_max", "Severity range bounds"},
				{"q", "Free-text search across label/name/indicator/district"},
				{"limit", "Max features per response, default 2500, max 5000"},
			},
			Examples: []string{
				base + "/api/locations.geojson",
				base + "/api/locations.geojson?country=Zambia",
				base + "/api/locations.geojson?country=Malawi&district=Salima&severity=5",
			},
		},
		{
			Method: "GET", URL: "/api/locations.csv", Title: "Locations (CSV)",
			Description: "Same data as the GeoJSON endpoint, returned as CSV for spreadsheets. Streamed — safe for large filter results. Use the same query params.",
			Params:      []apiParam{{"(same filters as the GeoJSON endpoint)", ""}},
			Examples: []string{
				base + "/api/locations.csv",
				base + "/api/locations.csv?country=Zambia&district=Petauke",
			},
		},
		{
			Method: "GET", URL: "/api/districts.geojson", Title: "District Boundaries (GeoJSON)",
			Description: "ADM2 district polygons (pre-simplified for fast loading). The `is_matched` property flags districts that intersect the current filter.",
			Params: []apiParam{
				{"country", "Malawi or Zambia (omit for both — larger payload)"},
				{"(any locations filter)", "narrows which districts are flagged is_matched=true"},
			},
			Examples: []string{base + "/api/districts.geojson?country=Zambia"},
		},
		{
			Method: "GET", URL: "/api/indicators", Title: "Indicator Summary (JSON)",
			Description: "Counts of locations per raw indicator value, honoring filters. Useful for ranking hotspot types within a district.",
			Params:      []apiParam{{"(any locations filter)", ""}},
			Examples:    []string{base + "/api/indicators?country=Malawi"},
		},
		{
			Method: "GET", URL: "/api/selections", Title: "Selection Votes (JSON)",
			Description: "Aggregated counts of user-submitted indicator selections per district.",
			Params:      []apiParam{{"district", "District name"}},
			Examples:    []string{base + "/api/selections"},
		},
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := s.pages.ExecuteTemplate(w, "api_docs.html", map[string]any{
		"BaseURL":   base,
		"Endpoints": endpoints,
	}); err != nil {
		s.render500(w, err)
	}
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func cloneValues(v url.Values) url.Values {
	out := make(url.Values, len(v))
	for k, vals := range v {
		cp := make([]string, len(vals))
		copy(cp, vals)
		out[k] = cp
	}
	return out
}

// sortByCountThenName sorts a slice in place by descending count, then
// ascending name, given an accessor returning (count, name) for index i.
func sortByCountThenName[T any](items []T, key func(i int) (int, string)) {
	for i := 1; i < len(items); i++ {
		for j := i; j > 0; j-- {
			ci, ni := key(j)
			cp, np := key(j - 1)
			less := ci > cp || (ci == cp && ni < np)
			if !less {
				break
			}
			items[j], items[j-1] = items[j-1], items[j]
		}
	}
}

// ---- gzip middleware (mirrors Django's GZipMiddleware) ----

type gzipResponseWriter struct {
	http.ResponseWriter
	gz *gzip.Writer
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) { return g.gz.Write(b) }

func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		gz := gzip.NewWriter(w)
		defer gz.Close()
		next.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, gz: gz}, r)
	})
}
