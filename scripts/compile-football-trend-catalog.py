"""Compile frozen catalog math to a small, non-executable predicate AST.

Regeneration fails on unrecognized split/history/price conditions. Context-only
rules retain their required input class and are never inferred from labels.
"""
import ast
import json
import re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def normalize(text, market, rid):
    s=text.split(' Status:')[0].split(' Note:')[0].split(';')[0].strip().rstrip('.')
    s=re.sub(r'\. Q\d+ and D must both exist\.?$', '', s)
    s=re.sub(r'^A (?:side|team|total side|spread side|spread team) s has ', '', s)
    s=s.replace('f is the favorite at D, ', '')
    s=s.replace(', and the same game has ', ' and ').replace(' on its total market','')
    s=s.replace('s is the designated home team','isHome = 1').replace('s is the designated away team','isAway = 1')
    s=s.replace('and either ', 'and (')
    if 'and (' in s and ' or ' in s and rid.startswith('spread-ticket-current'): s+=')'
    s=s.replace('and at least 60 minutes separate its first usable retained observation and D','and openingMinutes >= 60')
    s=s.replace(', with ', ' and ')
    specials={
      'Every eligible game with a paired final spread quote and a designated home team':'isHome = 1',
      'Every eligible game with a nonzero paired final spread':'Ld(f) < 0',
      'Every eligible game with a paired final game-total quote':'Td > 0',
      'L0(s) = Ld(s) for spread, or T0 = Td for total':'L0(s) = Ld(s)' if market=='Spread' else 'T0 = Td',
      'The quoted line is unchanged for s':'L0(s) = Ld(s)' if market=='Spread' else 'T0 = Td',
      'Both sides retain the same paired quoted line between O and D':'L0(s) = Ld(s)' if market=='Spread' else 'T0 = Td',
      'at least 3 nonzero line changes':'nonzeroChanges(s) >= 3',
      'every nonzero support increment is positive':'negativeChanges(s) = 0',
      'at least 3 consecutive latest support increments, each >= 0.5 points':'lastThreeSupport(s) = 1',
      'at least 2 support-direction reversals after zero increments are removed':'reversals(s) >= 2',
      'final nonzero increment > 0':'lastNonzero(s) > 0',
      'a saved consecutive support jump >= 2 points':'maxJump(s) >= 2',
      'at least 4 positive increments':'positiveChanges(s) >= 4',
      'no absolute consecutive increment >= 1 point':'maxAbsJump(s) < 1',
    }
    for a,b in specials.items(): s=s.replace(a,b)
    s=re.sub(r'\b(?:percentage points|points|point|pp)\b','',s).replace('%','')
    # Side and interval names become identifiers. abs remains an AST operation.
    s=re.sub(r'(\w+)\((s|anchor|Home|Away|Over|Under|f)\s*,\s*(O|Q\d+)\s*,\s*(D|Q\d+)\)',lambda m:'_'.join(m.groups()),s)
    s=re.sub(r'(\w+)\((s|anchor|Home|Away|Over|Under|f)\)',lambda m:m[1]+'_'+m[2],s)
    s=re.sub(r',\s*(?:and\s+)?',' and ',s)
    s=re.sub(r'(?<![<>=!])=(?!=)','==',s)
    return ' '.join(s.split())

def node(n):
    if isinstance(n,ast.Constant) and isinstance(n.value,(int,float,bool)):return n.value
    if isinstance(n,ast.Name):return ['v',n.id]
    if isinstance(n,ast.UnaryOp) and isinstance(n.op,ast.USub):return ['neg',node(n.operand)]
    if isinstance(n,ast.BinOp):return [{ast.Add:'+',ast.Sub:'-',ast.Mult:'*',ast.Div:'/'}[type(n.op)],node(n.left),node(n.right)]
    if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='abs':return ['abs',node(n.args[0])]
    if isinstance(n,ast.BoolOp):return ['and' if isinstance(n.op,ast.And) else 'or',*[node(x) for x in n.values]]
    if isinstance(n,ast.Compare):return ['cmp',[{ast.Lt:'<',ast.LtE:'<=',ast.Gt:'>',ast.GtE:'>=',ast.Eq:'=='}[type(o)] for o in n.ops],[node(n.left),*[node(c) for c in n.comparators]]]
    raise ValueError(ast.dump(n))

def parse_math(s):return node(ast.parse(s,mode='eval').body)

def compile_sport(sport):
    text=(ROOT/f'lib/catalog/{sport}-2026-10-11.md').read_text()
    rules=[]; filters=[]; errors=[]
    for line in text.splitlines():
      if re.match(r'^\| [a-z0-9].* / (Spread|Total) \|',line):
        r=[a.strip() for a in line.split('|')[1:-1]]
        rid,market=r[0].split(' / ')
        names=[a.split(' → ') for a in r[1:3]]
        rule={'id':rid,'market':market,'names':[n[0] for n in names],'selections':[n[1] for n in names],'trigger':r[3],'data':r[4]}
        if r[4] in ['B','E','H','P']:
          try:rule['predicate']=parse_math(normalize(r[3],market,rid))
          except Exception as e:errors.append((rid,normalize(r[3],market,rid),str(e)))
        rules.append(rule)
    if errors:
      for e in errors: print(e)
      raise SystemExit('Uncompiled market predicates')
    for line in text.split('## Exact subset filters')[1].split('## Worked')[0].splitlines():
      if not re.match(r'^\| [a-z0-9]',line):continue
      r=[a.strip() for a in line.split('|')[1:-1]]
      if len(r)!=4:continue
      filters.append({'id':r[0],'label':r[1].split(' / ')[-1],'condition':r[2],'market':r[3].split(' / ')[0],'data':r[3].split(' / ')[-1]})
    combos=[]
    parent_names={name:rule for rule in rules for name in rule['names']}
    filter_names={f['label']:f['id'] for f in filters}
    worked=text.split('## Worked combined subsets')[1].split('## ')[0]
    for line in worked.splitlines():
      if not line.startswith('| ') or line.startswith('| Combined'):continue
      r=[a.strip() for a in line.split('|')[1:-1]]
      if len(r)!=4:continue
      parts=r[0].split(' + '); parent=parent_names.get(parts[0])
      if not parent:raise ValueError(('parent',parts[0]))
      ids=[]
      for name in parts[1:]:
        # NCAAF earlier document called the explicit >20pp filter Plus20.
        name={'Saturday Games':'Saturday','Ticket Gain Above20pp':'Tickets Gain More Than 20 pp','Ticket Gain Above 20pp':'Tickets Gain More Than 20 pp'}.get(name,name)
        if name not in filter_names:raise ValueError(('filter',sport,name))
        ids.append(filter_names[name])
      combos.append({'parent':parent['id'],'filters':sorted(ids)})
    return {'version':sport+'-catalog-2026-10-11-v1','rules':rules,'filters':filters,'combinations':combos}

if __name__=='__main__':
    for sport in ['nfl','ncaaf']:
      obj=compile_sport(sport)
      target=ROOT/f'lib/catalog/{sport}Catalog.ts'
      target.write_text('// Generated by scripts/compile-football-trend-catalog.py. Do not hand edit.\nimport type { CatalogDefinition } from \"../footballTrendCatalog\";\nexport const catalog: CatalogDefinition = '+json.dumps(obj,ensure_ascii=False,separators=(',',':'))+';\n')
      print(sport,len(obj['rules'])*2,'directions',len(obj['filters']),'filters',len(obj['combinations']),'combinations')
