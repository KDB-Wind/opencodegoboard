import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModelIcon } from './ModelIcon';

describe('model icon imports', () => {
  it.each(['gpt-5.5', 'qwen3', 'claude-sonnet', 'unknown-model'])('renders %s without loading unrelated UI features', model => {
    const markup = renderToStaticMarkup(<ModelIcon model={model} />);
    expect(markup).toContain('<svg');
    expect(markup).toContain(`aria-label="${model}"`);
  });
});
