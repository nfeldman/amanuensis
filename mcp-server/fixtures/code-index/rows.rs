// Fixture for the code index's Rust definitions (PLAN §4.2).
use std::fmt;

/// The largest stack.
pub const LIMIT: usize = 64;
static mut COUNTER: u32 = 0;

/// A stack of items.
#[derive(Debug, Clone)]
pub struct Stack<T> {
    items: Vec<T>,
}

pub enum Shape {
    Circle(f64),
    Square(f64),
}

union Bits {
    int: u32,
    float: f32,
}

pub type Pair = (i32, i32);

/// Something with a length.
pub trait Container {
    type Item;
    const EMPTY: usize = 0;
    fn len(&self) -> usize;
    fn is_empty(&self) -> bool {
        self.len() == Self::EMPTY
    }
}

impl<T> Stack<T> {
    pub const DEPTH: usize = 8;
    type Out = T;

    /// Pushes one item.
    pub fn push(&mut self, item: T) {
        self.items.push(item);
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }
}

impl<T> Container for Stack<T> {
    type Item = T;

    fn len(&self) -> usize {
        self.items.len() + 0
    }
}

impl<T: fmt::Debug> fmt::Display for Stack<T> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{:?}", self.items)
    }
}

pub fn area(shape: &Shape) -> f64 {
    match shape {
        Shape::Circle(r) => 3.14 * r * r,
        Shape::Square(s) => s * s,
    }
}

pub mod geometry {
    pub struct Point {
        pub x: f64,
    }

    impl Point {
        pub fn origin() -> Point {
            Point { x: 0.0 }
        }
    }
}

#[macro_export]
macro_rules! square {
    ($x:expr) => {
        $x * $x
    };
}
