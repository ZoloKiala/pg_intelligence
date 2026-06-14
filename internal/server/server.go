package server

import (
	"html/template"
	"log"
	"net/http"
	"path/filepath"

	"pgis/internal/store"
)

// Server holds everything the HTTP handlers need.
type Server struct {
	store      *store.Store
	derived    *Derived
	boundaries *Boundaries
	pages      *template.Template
	errPages   *template.Template
	staticDir  string
}

// New builds a Server. templatesDir holds the HTML templates, staticDir the
// static assets, dataDir the GeoJSON boundary files.
func New(st *store.Store, templatesDir, staticDir, dataDir string) (*Server, error) {
	pages, err := template.New("pages").Funcs(templateFuncs()).ParseFiles(
		filepath.Join(templatesDir, "dashboard.html"),
		filepath.Join(templatesDir, "api_docs.html"),
	)
	if err != nil {
		return nil, err
	}
	errPages, err := template.ParseFiles(
		filepath.Join(templatesDir, "errors", "404.html"),
		filepath.Join(templatesDir, "errors", "500.html"),
	)
	if err != nil {
		return nil, err
	}
	boundaries, err := LoadBoundaries(dataDir)
	if err != nil {
		return nil, err
	}

	return &Server{
		store:      st,
		derived:    BuildDerived(st.Locations()),
		boundaries: boundaries,
		pages:      pages,
		errPages:   errPages,
		staticDir:  staticDir,
	}, nil
}

// Handler builds the HTTP routing (Go 1.22 method+pattern mux).
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /{$}", s.dashboard)
	mux.HandleFunc("GET /api/{$}", s.apiDocs)
	mux.HandleFunc("GET /api/locations.geojson", s.locationsGeoJSON)
	mux.HandleFunc("GET /api/locations.csv", s.locationsCSV)
	mux.HandleFunc("GET /api/districts.geojson", s.districtBoundaries)
	mux.HandleFunc("GET /api/indicators", s.indicatorSummary)
	mux.HandleFunc("GET /api/selections", s.selectionResults)
	mux.HandleFunc("POST /selections/submit", s.submitSelection)

	fs := http.StripPrefix("/static/", http.FileServer(http.Dir(s.staticDir)))
	mux.Handle("GET /static/", fs)

	// Catch-all: anything not matched above renders the styled 404 page.
	mux.HandleFunc("/", s.notFound)

	return gzipMiddleware(mux)
}

func (s *Server) render404(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	if err := s.errPages.ExecuteTemplate(w, "404.html", nil); err != nil {
		log.Printf("render 404: %v", err)
	}
}

func (s *Server) render500(w http.ResponseWriter, cause error) {
	log.Printf("server error: %v", cause)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusInternalServerError)
	if err := s.errPages.ExecuteTemplate(w, "500.html", nil); err != nil {
		log.Printf("render 500: %v", err)
	}
}

func (s *Server) notFound(w http.ResponseWriter, r *http.Request) {
	s.render404(w)
}
