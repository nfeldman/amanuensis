// Fixture: the first half of a partial class (PLAN §4.2).
namespace Acme.Parts;

/// A widget, declared in two files.
public partial class Widget<T>
{
    public int Size { get; set; }

    partial void OnChanged(int value);

    partial void OnReset();
}

public static class Extensions
{
    public static int Twice(this int n) => n * 2;
}
