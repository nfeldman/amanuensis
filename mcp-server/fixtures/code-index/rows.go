// Package shapes is a fixture for the code-index extractor: every Go row of PLAN §4.2.
package shapes

import (
	"fmt"
	m "math"
)

// Pi is close enough.
const Pi = 3.14

const (
	Small, Large = 1, 2
)

var registry = map[string]Shape{}

// Shape has an area.
type Shape interface {
	Area() float64
}

type (
	// Square has a side.
	Square struct{ Side float64 }
	Meters = float64
)

type List[T any] struct{ items []T }

// NewSquare makes one.
func NewSquare(side float64) *Square {
	return &Square{Side: side}
}

// Area of a square.
func (s *Square) Area() float64 {
	return s.Side * s.Side
}

func (s Square) String() string {
	return fmt.Sprint(s.Side)
}

func (l *List[T]) Push(v T) {
	l.items = append(l.items, v)
}

func (c Circle) Area() float64 {
	return m.Pi * c.R * c.R
}

type Circle struct{ R float64 }
