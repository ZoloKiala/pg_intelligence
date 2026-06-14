package server

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type rawFeature struct {
	Type       string                 `json:"type"`
	Properties map[string]interface{} `json:"properties"`
	Geometry   json.RawMessage        `json:"geometry"`
}

type featureCollection struct {
	Features []rawFeature `json:"features"`
}

// Boundaries holds the pre-simplified ADM2 district polygons per country.
type Boundaries struct {
	Malawi []rawFeature
	Zambia []rawFeature
}

// LoadBoundaries reads the simplified GeoJSON boundary files from dataDir.
// Missing files yield empty feature sets (the dashboard still works).
func LoadBoundaries(dataDir string) (*Boundaries, error) {
	b := &Boundaries{}
	var err error
	if b.Malawi, err = loadBoundaryFile(filepath.Join(dataDir, "geoBoundaries-MWI-ADM2.simplified.geojson")); err != nil {
		return nil, err
	}
	if b.Zambia, err = loadBoundaryFile(filepath.Join(dataDir, "geoBoundaries-ZMB-ADM2.simplified.geojson")); err != nil {
		return nil, err
	}
	return b, nil
}

func loadBoundaryFile(path string) ([]rawFeature, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var fc featureCollection
	if err := json.Unmarshal(data, &fc); err != nil {
		return nil, err
	}
	return fc.Features, nil
}

// forCountry returns the boundary features for a country ("" = both).
func (b *Boundaries) forCountry(country string) []rawFeature {
	switch country {
	case "Malawi":
		return b.Malawi
	case "Zambia":
		return b.Zambia
	default:
		out := make([]rawFeature, 0, len(b.Malawi)+len(b.Zambia))
		out = append(out, b.Malawi...)
		out = append(out, b.Zambia...)
		return out
	}
}
