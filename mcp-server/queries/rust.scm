; Definition queries for Rust (PLAN §4.2). The code index reads its definitions from these
; patterns, never from the grammar's tags.scm.
;
; @definition.<kind> captures the whole item, @name its name, and @import a use
; declaration's argument. When one node is captured by several patterns, the earliest pattern
; wins, so a function in an impl or trait is a method once, not also a function. Inside
; `impl T` an item is T.<name> and inside `impl Trait for T` it is <T as Trait>.<name>; the
; extractor names the impl block itself. Outer attributes join an item's citeable span.

; Functions in impl blocks and traits, with or without a body.
(impl_item body: (declaration_list (function_item name: (identifier) @name) @definition.method))
(trait_item body: (declaration_list (function_item name: (identifier) @name) @definition.method))
(trait_item
  body: (declaration_list (function_signature_item name: (identifier) @name) @definition.method))

; Functions, wherever they are defined.
(function_item name: (identifier) @name) @definition.function

; Impl blocks, named by the extractor from their type and trait.
(impl_item) @definition.impl

; Types and traits.
(struct_item name: (type_identifier) @name) @definition.struct
(enum_item name: (type_identifier) @name) @definition.enum
(union_item name: (type_identifier) @name) @definition.union
(trait_item name: (type_identifier) @name) @definition.trait
(type_item name: (type_identifier) @name) @definition.type
(associated_type name: (type_identifier) @name) @definition.type

; Consts, statics, modules and macros.
(const_item name: (identifier) @name) @definition.const
(static_item name: (identifier) @name) @definition.static
(mod_item name: (identifier) @name) @definition.module
(macro_definition name: (identifier) @name) @definition.macro

; Imports.
(use_declaration argument: (_) @import)
