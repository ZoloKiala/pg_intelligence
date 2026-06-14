// Command pgis serves the Participatory Hotspot Dashboard — a Go port of the
// original Django app. It serves the dashboard, the GeoJSON/CSV/JSON APIs, and
// the indicator-selection form over a single binary, backed by SQLite.
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"pgis/internal/server"
	"pgis/internal/store"
)

func main() {
	addr := flag.String("addr", "", "listen address (default :$PORT or :8000)")
	selPath := flag.String("selections", env("SELECTIONS_PATH", "selections.json"), "path to persist community selections")
	dataDir := flag.String("data", env("DATA_DIR", "data"), "directory with CSV + GeoJSON data")
	staticDir := flag.String("static", env("STATIC_DIR", "static"), "static assets directory")
	tmplDir := flag.String("templates", env("TEMPLATES_DIR", "templates"), "HTML templates directory")
	flag.Parse()

	listenAddr := *addr
	if listenAddr == "" {
		port := env("PORT", "8000")
		listenAddr = ":" + port
	}

	st, err := store.New(*selPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	if err := loadData(st, *dataDir); err != nil {
		log.Fatalf("load data: %v", err)
	}
	st.SortLocations()
	log.Printf("loaded %d locations", st.LocationCount())

	srv, err := server.New(st, *tmplDir, *staticDir, *dataDir)
	if err != nil {
		log.Fatalf("init server: %v", err)
	}

	httpServer := &http.Server{
		Addr:              listenAddr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("listening on %s", listenAddr)
	if err := httpServer.ListenAndServe(); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// loadData imports the preloaded CSVs into the in-memory store. Import is
// de-duplicated on external id, so loading both Malawi and Zambia is safe.
func loadData(st *store.Store, dataDir string) error {
	for _, name := range []string{"preloaded_locations.csv", "preloaded_locations_zambia.csv"} {
		path := filepath.Join(dataDir, name)
		if !fileExists(path) {
			continue
		}
		n, err := st.ImportCSV(path)
		if err != nil {
			return err
		}
		log.Printf("imported %d locations from %s", n, name)
	}
	return nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
