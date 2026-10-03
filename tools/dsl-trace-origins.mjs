// Carry line ownership through the transformations actually applied to a recipe.
// Diffs preserve existing owners; each insertion belongs to its supplying
// patch/partial (or the imperative emitter). Never inspect unrelated recipes.
import {diffLines} from 'diff';
const lines = text => text ? text.replace(/\n$/,'').split('\n') : [];
export function templateOrigins(file, text) {
  let owners = lines(text).map((_, i) => ({recipe:file,template_line:i+1}));
  return {
    get origins() {return new Map(owners.map((owner,i)=>[i+1,owner]));},
    observe(before, after, recipe) {
      if (before === after) return;
      const next=[]; let old=0, inserted=0;
      for (const chunk of diffLines(before,after)) {
        const count=lines(chunk.value).length;
        if (chunk.removed) old+=count;
        else if (chunk.added) for (let i=0;i<count;i++) next.push({recipe,template_line:++inserted});
        else {next.push(...owners.slice(old,old+count));old+=count;}
      }
      owners=next;
    },
  };
}
