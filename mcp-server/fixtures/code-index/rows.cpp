// Fixture for the code index's C++ definitions (PLAN §4.2).
#include <cstddef>
#include <utility>

#define CHECK(x) do { if (!(x)) throw 0; } while (0)

int run();
int total = 0;

namespace geo {

/// A buffer of values.
template <typename T>
class Buf {
public:
    Buf();
    explicit Buf(std::size_t size);
    ~Buf();

    T& get() &;
    T&& get() &&;
    const T& get() const;
    T& get(int index);

    bool operator==(const Buf& other) const;
    Buf& operator=(Buf&& other) noexcept;

    std::size_t size() const { return size_; }
    virtual void reset() = 0;

    static const int kDepth = 4;

private:
    std::size_t size_;
    T* data_;

    struct Cursor {
        int at;
    };
};

struct Point {
    double x, y;
};

enum class Color { Red, Green };

using Index = std::size_t;
typedef unsigned char byte;

template <typename T>
concept Small = sizeof(T) < 8;

const double kPi = 3.14159;

// Makes one value.
template <typename T>
T make(int seed);

template <typename T, typename U>
T make(int seed) {
    return T(seed);
}

void Buf<int>::helper() {}

}  // namespace geo

namespace geo::detail {
inline int twice(int n) { return 2 * n; }
}

namespace outer {
void geo::Point::shift(double dx) {
    x += dx;
}
void ::geo::Point::scale(double k) {
    x *= k;
}
}

template <typename T>
geo::Buf<T>::Buf() : size_(0), data_(nullptr) {}

template <typename T>
geo::Buf<T>::~Buf() {
    delete[] data_;
}

template <typename T>
const T& geo::Buf<T>::get() const {
    return data_[0];
}

int run() {
    return geo::detail::twice(total);
}

union Word {
    int i;
    float f;
};

enum Level { Low, High };

template <typename T>
bool geo::Buf<T>::operator==(const Buf& other) const {
    return size_ == other.size_;
}

namespace geo::detail {
int half(int n);
}

int geo::detail::half(int n) {
    return n / 2;
}
