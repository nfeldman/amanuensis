// Fixture: the second half of a partial class (PLAN §4.2).
namespace Acme.Parts
{
    public partial class Widget<T>
    {
        partial void OnChanged(int value)
        {
            Size = value;
        }

        public void Render() { }
    }
}
