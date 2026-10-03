// Replay extends the sim recipe only for manifests carrying a profile.
import {readFileSync} from 'node:fs';
export function replayOverlay(text, scope, observe) {
  for (const {from,to,scope: target} of JSON.parse(readFileSync('recipes/l3-replay/overlay.json','utf8'))) {
    if (target !== 'both' && target !== scope) continue;
    if (!text.includes(from)) throw new Error(`replay ${scope} recipe lost anchor ${JSON.stringify(from)}`);
    const previous=text;
    text = text.replaceAll(from,to);
    observe?.(previous,text,'recipes/l3-replay/overlay.json');
  }
  return text;
}
