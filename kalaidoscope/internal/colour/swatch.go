package colour

import "github.com/pocketbase/pocketbase/core"

// SwatchCount is the size of the app's colour palette; colour.swatch is an
// index into it.
const SwatchCount = 8

// NextSwatch is the palette slot for a colour created now: round-robin over
// the palette in creation order, so the first SwatchCount colours are all
// distinct and a colour keeps its slot for life whatever is created or
// deleted around it.
func NextSwatch(app core.App) (int, error) {
	n, err := app.CountRecords("colour")
	if err != nil {
		return 0, err
	}
	return int(n % SwatchCount), nil
}
