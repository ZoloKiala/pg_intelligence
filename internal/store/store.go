// Package store holds the location dataset (loaded from CSV into memory) and
// the community indicator selections (persisted to a small JSON file). It has
// no external dependencies — the standard library covers it all.
//
// Locations are read-only after import, so an in-memory slice is ideal: the
// dataset is only a few thousand rows. Selections are appended and flushed to
// disk so they survive restarts.
package store

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var severityRE = regexp.MustCompile(`(?i)severity\s*=\s*(-?\d+)`)

// Location mirrors the Django Location model.
type Location struct {
	ExternalID  string
	Name        string
	Label       string
	DistrictKey string
	District    string
	Indicator   string
	Attribute2  string
	Severity    *int
	Latitude    float64
	Longitude   float64
	SourceFile  string
}

// Selection is one stored community indicator selection.
type Selection struct {
	Indicator string `json:"indicator"`
	District  string `json:"district"`
	Rationale string `json:"rationale"`
	CreatedAt string `json:"created_at"`
}

// SelectionResult is one aggregated row of community votes.
type SelectionResult struct {
	Indicator string `json:"indicator"`
	District  string `json:"district"`
	Votes     int    `json:"votes"`
}

// Store holds the locations and selections.
type Store struct {
	mu         sync.RWMutex
	locations  []Location
	byExternal map[string]bool
	selections []Selection
	selPath    string
}

// New creates a store, loading any previously persisted selections from path.
func New(selectionsPath string) (*Store, error) {
	s := &Store{
		byExternal: map[string]bool{},
		selPath:    selectionsPath,
	}
	if err := s.loadSelections(); err != nil {
		return nil, err
	}
	return s, nil
}

// Close is a no-op (kept for symmetry with database-backed stores).
func (s *Store) Close() error { return nil }

// LocationCount returns the number of loaded locations.
func (s *Store) LocationCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.locations)
}

// ImportCSV appends locations from a CSV file, de-duplicating on external id
// (mirrors the Django loader's ignore_conflicts on the unique external_id).
// Returns the number of newly added rows.
func (s *Store) ImportCSV(path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	reader := csv.NewReader(f)
	header, err := reader.Read()
	if err != nil {
		return 0, fmt.Errorf("reading header: %w", err)
	}
	col := make(map[string]int, len(header))
	for i, name := range header {
		col[strings.TrimSpace(name)] = i
	}
	get := func(row []string, name string) string {
		if i, ok := col[name]; ok && i < len(row) {
			return strings.TrimSpace(row[i])
		}
		return ""
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	created := 0
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return created, err
		}

		externalID := get(row, "id")
		if externalID != "" && s.byExternal[externalID] {
			continue
		}

		attribute2 := get(row, "attribute_2")
		var severity *int
		if m := severityRE.FindStringSubmatch(attribute2); m != nil {
			if v, err := strconv.Atoi(m[1]); err == nil {
				severity = &v
			}
		}
		lat, _ := strconv.ParseFloat(orZero(get(row, "latitude")), 64)
		lon, _ := strconv.ParseFloat(orZero(get(row, "longitude")), 64)

		s.locations = append(s.locations, Location{
			ExternalID:  externalID,
			Name:        get(row, "name"),
			Label:       get(row, "label"),
			DistrictKey: get(row, "district_key"),
			District:    get(row, "district"),
			Indicator:   get(row, "attribute_1"),
			Attribute2:  attribute2,
			Severity:    severity,
			Latitude:    lat,
			Longitude:   lon,
			SourceFile:  get(row, "source_file"),
		})
		if externalID != "" {
			s.byExternal[externalID] = true
		}
		created++
	}
	return created, nil
}

// SortLocations orders locations by district, indicator, name (the Django
// Location.Meta ordering). Call once after all CSVs are imported.
func (s *Store) SortLocations() {
	s.mu.Lock()
	defer s.mu.Unlock()
	sort.SliceStable(s.locations, func(i, j int) bool {
		a, b := s.locations[i], s.locations[j]
		if a.District != b.District {
			return a.District < b.District
		}
		if a.Indicator != b.Indicator {
			return a.Indicator < b.Indicator
		}
		return a.Name < b.Name
	})
}

// Locations returns the loaded locations (read-only — do not mutate).
func (s *Store) Locations() []Location {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.locations
}

// AddSelection records a community indicator selection and persists it.
func (s *Store) AddSelection(indicator, district, rationale string) error {
	s.mu.Lock()
	s.selections = append(s.selections, Selection{
		Indicator: indicator,
		District:  district,
		Rationale: rationale,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})
	s.mu.Unlock()
	return s.saveSelections()
}

// SelectionResults returns vote counts per (indicator, district), optionally
// filtered to a single district, ordered by votes desc then indicator.
func (s *Store) SelectionResults(district string) ([]SelectionResult, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	type key struct{ indicator, district string }
	counts := map[key]int{}
	var order []key
	for _, sel := range s.selections {
		if district != "" && sel.District != district {
			continue
		}
		k := key{sel.Indicator, sel.District}
		if _, seen := counts[k]; !seen {
			order = append(order, k)
		}
		counts[k]++
	}

	results := make([]SelectionResult, 0, len(order))
	for _, k := range order {
		results = append(results, SelectionResult{
			Indicator: k.indicator, District: k.district, Votes: counts[k],
		})
	}
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].Votes != results[j].Votes {
			return results[i].Votes > results[j].Votes
		}
		return results[i].Indicator < results[j].Indicator
	})
	return results, nil
}

func (s *Store) loadSelections() error {
	if s.selPath == "" {
		return nil
	}
	data, err := os.ReadFile(s.selPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, &s.selections)
}

func (s *Store) saveSelections() error {
	if s.selPath == "" {
		return nil
	}
	s.mu.RLock()
	data, err := json.MarshalIndent(s.selections, "", "  ")
	s.mu.RUnlock()
	if err != nil {
		return err
	}
	return os.WriteFile(s.selPath, data, 0o644)
}

func orZero(s string) string {
	if s == "" {
		return "0"
	}
	return s
}
