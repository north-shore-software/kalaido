package parsers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"strings"
)

func parseMbox(ctx context.Context, src Source, emit Emit) error {
	br := bufio.NewReaderSize(bytes.NewReader(src.Data), 1<<20)
	var block []byte
	started := false

	process := func() error {
		if len(block) == 0 {
			return nil
		}
		raw := block
		block = nil
		return emit(oneEmail(raw))
	}

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		line, readErr := br.ReadBytes('\n')
		if len(line) > 0 {
			if bytes.HasPrefix(line, []byte("From ")) {
				if started {
					if err := process(); err != nil {
						return err
					}
				}
				started = true // drop the envelope line itself
			} else {
				block = append(block, unquoteFromLine(line)...)
				started = true
			}
		}
		if readErr != nil {
			if started {
				if err := process(); err != nil {
					return err
				}
			}
			if readErr == io.EOF {
				return nil
			}
			return readErr
		}
	}
}

func oneEmail(raw []byte) Fragment {
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		// Unparseable — keep the raw text rather than dropping the message.
		return Fragment{Type: "email", Source: "imported email", Content: string(raw)}
	}

	from := decodeHeader(msg.Header.Get("From"))
	to := decodeHeader(msg.Header.Get("To"))
	subject := decodeHeader(msg.Header.Get("Subject"))
	date := strings.TrimSpace(msg.Header.Get("Date"))
	body := extractText(msg.Header.Get("Content-Type"), msg.Header.Get("Content-Transfer-Encoding"), msg.Body)

	var sb strings.Builder
	writeHeader := func(label, value string) {
		if strings.TrimSpace(value) != "" {
			fmt.Fprintf(&sb, "%s: %s\n", label, value)
		}
	}
	writeHeader("From", from)
	writeHeader("To", to)
	writeHeader("Subject", subject)
	writeHeader("Date", date)
	sb.WriteString("\n")
	sb.WriteString(body)

	source := strings.TrimSpace(from)
	if subject != "" {
		if source != "" {
			source += " · " + subject
		} else {
			source = subject
		}
	}
	if source == "" {
		source = "imported email"
	}

	occurredAt, _ := msg.Header.Date()
	return Fragment{Type: "email", Source: source, Content: sb.String(), SourceTime: occurredAt}
}

func extractText(contentType, transferEncoding string, body io.Reader) string {
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType == "" {
		return decodeBody(transferEncoding, body)
	}
	if strings.HasPrefix(mediaType, "multipart/") {
		boundary := params["boundary"]
		if boundary == "" {
			return readAllString(body)
		}
		mr := multipart.NewReader(body, boundary)
		var fallback string
		for {
			part, err := mr.NextPart()
			if err != nil {
				break
			}
			pct := part.Header.Get("Content-Type")
			text := extractText(pct, part.Header.Get("Content-Transfer-Encoding"), part)
			pmt, _, _ := mime.ParseMediaType(pct)
			if strings.HasPrefix(pmt, "text/plain") && strings.TrimSpace(text) != "" {
				return text
			}
			if fallback == "" && strings.TrimSpace(text) != "" {
				fallback = text
			}
		}
		return fallback
	}
	if strings.HasPrefix(mediaType, "text/") {
		return decodeBody(transferEncoding, body)
	}
	return "" // non-text single part (attachment) — skip
}

func decodeBody(transferEncoding string, body io.Reader) string {
	switch strings.ToLower(strings.TrimSpace(transferEncoding)) {
	case "quoted-printable":
		return readAllString(quotedprintable.NewReader(body))
	case "base64":
		return readAllString(base64.NewDecoder(base64.StdEncoding, body))
	default:
		return readAllString(body)
	}
}

// decodeHeader decodes RFC 2047 encoded-words (e.g. "=?UTF-8?B?...?=") in a
// header value, returning the value unchanged if it isn't encoded.
func decodeHeader(s string) string {
	if s == "" {
		return ""
	}
	out, err := new(mime.WordDecoder).DecodeHeader(s)
	if err != nil {
		return s
	}
	return out
}

func unquoteFromLine(line []byte) []byte {
	i := 0
	for i < len(line) && line[i] == '>' {
		i++
	}
	if i > 0 && bytes.HasPrefix(line[i:], []byte("From ")) {
		return line[1:]
	}
	return line
}
