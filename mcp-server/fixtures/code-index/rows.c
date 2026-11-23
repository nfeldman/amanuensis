/* Fixture for the code index's C definitions (PLAN §4.2). */
#include <stdio.h>
#include "local.h"

/* The largest buffer. */
#define LIMIT 64
#define SQUARE(x) ((x) * (x))

int counter = 0;
static const char *greeting = "hello", *farewell = "bye";
extern int shared;

int scale(int value);

/* A point in the plane. */
struct point {
    int x;
    int y;
};

union bits {
    unsigned int word;
    float real;
};

enum color { RED, GREEN, BLUE };

typedef unsigned long size_type;
typedef struct node {
    struct node *next;
} node_t, *node_ptr;
typedef int (*compare_fn)(const void *, const void *);

#ifdef DEBUG
static int verbose = 1;
#endif

/* Adds two numbers. */
static int add(int a, int b)
{
    return a + b;
}

char *name_of(struct point *p)
{
    static int calls = 0;
    struct local { int n; } seen = { 1 };
    calls += seen.n;
    return p->x > 0 ? "right" : "left";
}

int main(void)
{
    printf("%d\n", add(1, SQUARE(2)));
    return 0;
}
