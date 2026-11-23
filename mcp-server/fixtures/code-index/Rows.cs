// Fixture for the code index's C# definitions (PLAN §4.2).
using System;
using System.Collections.Generic;

namespace Acme.Tools
{
    /// <summary>A cache of values.</summary>
    [Serializable]
    public class Cache<T>
    {
        public const int Limit = 16;
        private readonly Dictionary<string, T> items = new(), spare = new();

        public Cache() { }

        ~Cache() { }

        public int Count { get; private set; }

        public T this[string key]
        {
            get { return items[key]; }
            set { items[key] = value; }
        }

        public event EventHandler Changed;

        public event EventHandler Cleared
        {
            add { Changed += value; }
            remove { Changed -= value; }
        }

        public bool Get(ref int index, out string name)
        {
            name = "";
            return true;
        }

        public bool Get<TKey>(ref int index, out string name)
        {
            name = "";
            return false;
        }

        public bool Get(int index, out string name)
        {
            name = index.ToString();
            int Local(int n) => n * 2;
            return Local(index) > 0;
        }

        public static Cache<T> operator +(Cache<T> a, Cache<T> b) => a;

        public class Entry
        {
            public string Key { get; set; }
        }
    }

    public interface IStore
    {
        void Put(string key);
    }

    public struct Slot
    {
        public int Index;
    }

    public record Point(int X, int Y);

    public enum Mode { Fast, Safe }

    public delegate void Handler<TArg>(TArg arg);

    namespace Inner
    {
        class Helper { }
    }
}

namespace Acme.Money
{
    public readonly struct Cents
    {
        public static implicit operator long(Cents c) => 0;
        public static explicit operator Cents(long n) => new Cents();
    }
}
