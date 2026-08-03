package parsers

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strings"
)

func parseDocx(ctx context.Context, src Source, emit Emit) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	text, err := docxToText(src.Data)
	if err != nil {
		return err
	}
	source := src.Name
	if strings.TrimSpace(source) == "" {
		source = "imported document"
	}
	return emit(Fragment{Type: "note", Source: source, Content: text})
}

func docxToText(data []byte) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("invalid docx archive: %w", err)
	}
	for _, f := range zr.File {
		if f.Name != "word/document.xml" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return "", err
		}
		defer rc.Close()
		body, err := io.ReadAll(rc)
		if err != nil {
			return "", err
		}
		return docxXMLToText(body), nil
	}
	return "", errors.New("not a docx: word/document.xml missing")
}

func docxXMLToText(data []byte) string {
	dec := xml.NewDecoder(bytes.NewReader(data))
	var sb strings.Builder
	inText := false
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "t":
				inText = true
			case "tab":
				sb.WriteString("\t")
			case "br", "cr":
				sb.WriteString("\n")
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inText = false
			case "p":
				sb.WriteString("\n")
			}
		case xml.CharData:
			if inText {
				sb.Write(t)
			}
		}
	}
	return strings.TrimSpace(sb.String())
}
