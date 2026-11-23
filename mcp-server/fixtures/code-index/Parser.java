package fixture;

import java.util.List;
import java.util.Map;

/** Parses things. */
@SuppressWarnings("unused")
public class Parser {
  private int depth = 0, width;
  static final String NAME = "parser";

  public Parser() {}

  public Parser(String source) {
    this.depth = source.length();
  }

  // Parse a whole string.
  public List<String> parse(String text) {
    return List.of(text);
  }

  public List<String> parse(String text, int limit) {
    return parse(text).subList(0, limit);
  }

  <T> T parse(Map<String, T> table, String... keys) {
    return null;
  }

  interface Visitor {
    int LIMIT = 3;
    void visit(String node);
  }

  enum Mode {
    STRICT,
    LOOSE;

    boolean strict() {
      return this == STRICT;
    }
  }

  record Span(int start, int end) {
    Span {
      if (end < start) throw new IllegalArgumentException();
    }
  }

  @interface Marker {
    String value();
  }
}
