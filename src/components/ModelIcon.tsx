import Anthropic from '@lobehub/icons/es/Anthropic/components/Mono';
import Cohere from '@lobehub/icons/es/Cohere/components/Color';
import DeepSeek from '@lobehub/icons/es/DeepSeek/components/Color';
import Google from '@lobehub/icons/es/Google/components/Color';
import Grok from '@lobehub/icons/es/Grok/components/Mono';
import Hunyuan from '@lobehub/icons/es/Hunyuan/components/Color';
import Meta from '@lobehub/icons/es/Meta/components/Color';
import Microsoft from '@lobehub/icons/es/Microsoft/components/Color';
import Minimax from '@lobehub/icons/es/Minimax/components/Color';
import Mistral from '@lobehub/icons/es/Mistral/components/Color';
import Moonshot from '@lobehub/icons/es/Moonshot/components/Mono';
import OpenAI from '@lobehub/icons/es/OpenAI/components/Mono';
import Qwen from '@lobehub/icons/es/Qwen/components/Color';
import XiaomiMiMo from '@lobehub/icons/es/XiaomiMiMo/components/Mono';
import ZeroOne from '@lobehub/icons/es/ZeroOne/components/Color';
import Zhipu from '@lobehub/icons/es/Zhipu/components/Color';
import type { IconType } from '@lobehub/icons';

const map: [RegExp, IconType][] = [
  [/qwen/i, Qwen],
  [/deepseek/i, DeepSeek],
  [/kimi|k2|moonshot/i, Moonshot],
  [/glm|zhipu|chatglm/i, Zhipu],
  [/hy3|hunyuan/i, Hunyuan],
  [/mimo/i, XiaomiMiMo],
  [/minimax/i, Minimax],
  [/gpt|o1|o3|chatgpt|openai|dall-e|whisper|tts|embed/i, OpenAI],
  [/claude|anthropic/i, Anthropic],
  [/gemini|gemma/i, Google],
  [/llama|meta/i, Meta],
  [/mistral/i, Mistral],
  [/cohere|command/i, Cohere],
  [/yi-/i, ZeroOne],
  [/phi/i, Microsoft],
  [/grok/i, Grok],
];

function matchIcon(model: string): IconType | null {
  for (const [re, icon] of map) {
    if (re.test(model)) return icon;
  }
  return null;
}

export function ModelIcon({ model, className = 'w-4 h-4' }: { model: string; className?: string }) {
  const Icon = matchIcon(model);
  if (!Icon) {
    return (
      <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-label={model} role="img">
        <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.18" />
        <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  return <Icon className={`${className} shrink-0`} aria-label={model} title={model} />;
}
