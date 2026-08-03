package httpx

import (
	"net"
	"net/http"
	"time"
)

var sharedTransport = &http.Transport{
	Proxy: http.ProxyFromEnvironment,
	DialContext: (&net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext,
	ForceAttemptHTTP2:     true,
	MaxIdleConns:          100,
	IdleConnTimeout:       90 * time.Second,
	TLSHandshakeTimeout:   10 * time.Second,
	ExpectContinueTimeout: 1 * time.Second,
	ResponseHeaderTimeout: 30 * time.Second,
}

var streamingTransport = func() *http.Transport {
	t := sharedTransport.Clone()
	t.ResponseHeaderTimeout = 0
	return t
}()

func Streaming() *http.Client {
	return &http.Client{Transport: streamingTransport}
}

func Short(d time.Duration) *http.Client {
	return &http.Client{Transport: sharedTransport, Timeout: d}
}
