function hashFilename(filename) {
  let hash = 2166136261

  for (let index = 0; index < filename.length; index += 1) {
    hash ^= filename.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}

module.exports = function ({ types: t }) {
  let fileKey = 'unknown'
  let styleIndex = 0

  return {
    name: 'tailwind-v4-react-native-web',
    pre(file) {
      fileKey = hashFilename(file.opts.filename ?? 'unknown')
      styleIndex = 0
    },
    visitor: {
      JSXOpeningElement(path) {
        const elementName = path.node.name;
        if (t.isJSXIdentifier(elementName) && /^[a-z]/.test(elementName.name)) {
          return;
        }

        const className = path.node.attributes.find(
          (attribute) => t.isJSXAttribute(attribute) && attribute.name.name === 'className',
        );
        if (!className?.value) return;

        const classExpression = t.isStringLiteral(className.value)
          ? className.value
          : t.isJSXExpressionContainer(className.value) &&
              !t.isJSXEmptyExpression(className.value.expression)
            ? className.value.expression
            : null;
        if (!classExpression) return;

        const styleKey = t.identifier(`_tailwind_${fileKey}_${styleIndex++}`)
        const cssStyle = t.objectExpression([
          t.objectProperty(t.identifier('$$css'), t.booleanLiteral(true)),
          t.objectProperty(styleKey, t.cloneNode(classExpression, true)),
        ]);

        const style = path.node.attributes.find(
          (attribute) => t.isJSXAttribute(attribute) && attribute.name.name === 'style',
        );

        if (style) {
          if (!t.isJSXExpressionContainer(style.value)) return;
          style.value.expression = t.arrayExpression([cssStyle, style.value.expression]);
          return;
        }

        path.node.attributes.push(
          t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(cssStyle)),
        );
      },
    },
  };
};
