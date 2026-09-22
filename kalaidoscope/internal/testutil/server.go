package testutil

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

type TestServer struct {
	App        core.App
	Server     *httptest.Server
	BaseURL    string
	HTTPClient *http.Client
}

func NewTestServer(t *testing.T, app core.App) *TestServer {
	t.Helper()

	r, err := apis.NewRouter(app)
	if err != nil {
		t.Fatalf("new router: %v", err)
	}

	dummyServer := &http.Server{}
	serveEvent := &core.ServeEvent{
		App:    app,
		Router: r,
		Server: dummyServer,
	}

	if err := app.OnServe().Trigger(serveEvent, func(e *core.ServeEvent) error {
		return nil
	}); err != nil {
		t.Fatalf("on serve: %v", err)
	}

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatalf("build mux: %v", err)
	}

	ts := httptest.NewServer(mux)
	t.Cleanup(func() {
		ts.Close()
		// What PocketBase's own serve does on SIGTERM: the terminate hooks
		// stop the workers the serve hooks started, before the app's
		// bootstrap state (registered earlier, so cleaned up later) goes.
		_ = app.OnTerminate().Trigger(&core.TerminateEvent{App: app}, func(*core.TerminateEvent) error { return nil })
		VerifyNoLeaks(t)
	})

	return &TestServer{
		App:        app,
		Server:     ts,
		BaseURL:    ts.URL,
		HTTPClient: ts.Client(),
	}
}
