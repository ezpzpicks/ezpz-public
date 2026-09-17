from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Could not locate {label}")
    return text.replace(old, new, 1)


# Today’s Model Plays -> app/FootballGameTabs.tsx
path = Path("app/FootballGameTabs.tsx")
text = path.read_text()

text = replace_once(
    text,
    'import { MatchupWithLogos, SelectionWithTeamLogo, TeamLogoName } from "./TeamLogoName";\n',
    'import { MatchupWithLogos, SelectionWithTeamLogo, TeamLogoName } from "./TeamLogoName";\nimport FootballModelFormBadges from "./FootballModelFormBadges";\n',
    "FootballGameTabs import",
)

text = replace_once(
    text,
    '''type FootballData = {
  today?: string;
  lastUpdated?: string;
  bestPlays?: Play[];
  slateToday?: SheetRow[];
  draftKings?: { status?: string; splits?: Split[] };
};''',
    '''type FootballData = {
  today?: string;
  lastUpdated?: string;
  bestPlays?: Play[];
  slateToday?: SheetRow[];
  betTrackerRows?: SheetRow[];
  draftKings?: { status?: string; splits?: Split[] };
};''',
    "FootballGameTabs FootballData",
)

text = replace_once(
    text,
    'function ModelPlayRow({ play, sport }: { play: Play; sport: Sport }) {',
    'function ModelPlayRow({ play, sport, data }: { play: Play; sport: Sport; data: FootballData }) {',
    "ModelPlayRow signature",
)

text = replace_once(
    text,
    '''      {form ? (
        <div className="fgtFormLine">
          <span className={`fgtBadge ${form.cls}`}>{form.icon} {form.label}</span>
          {formRecord ? <span className="fgtFormRecord">L7 <b>{formRecord}</b></span> : null}
        </div>
      ) : null}''',
    '''      {sport === "NCAAF" && !isProp ? (
        <FootballModelFormBadges
          rows={data.betTrackerRows || []}
          today={data.today}
          grade={play.playType}
          market={play.role || play.playType}
          selection={play.play}
          className="fgtModelFormBadges"
        />
      ) : form ? (
        <div className="fgtFormLine">
          <span className={`fgtBadge ${form.cls}`}>{form.icon} {form.label}</span>
          {formRecord ? <span className="fgtFormRecord">L7 <b>{formRecord}</b></span> : null}
        </div>
      ) : null}''',
    "ModelPlayRow form rendering",
)

text = replace_once(
    text,
    '<ModelPlayRow key={`${play.play}-${play.playerName}-${play.propMarket}-${index}`} play={play} sport={sport} />',
    '<ModelPlayRow key={`${play.play}-${play.playerName}-${play.propMarket}-${index}`} play={play} sport={sport} data={data} />',
    "ModelPlayRow invocation",
)

text = replace_once(
    text,
    '.fgtFormLine{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
    '.fgtFormLine{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.fgtModelFormBadges{grid-column:1/-1}',
    "FootballGameTabs form CSS",
)
path.write_text(text)


# EZPZ Picks -> app/FootballBoard.tsx
path = Path("app/FootballBoard.tsx")
text = path.read_text()

text = replace_once(
    text,
    'import { MatchupWithLogos, SelectionWithTeamLogo, TeamLogoName } from "./TeamLogoName";\n',
    'import { MatchupWithLogos, SelectionWithTeamLogo, TeamLogoName } from "./TeamLogoName";\nimport FootballModelFormBadges from "./FootballModelFormBadges";\n',
    "FootballBoard import",
)

text = replace_once(
    text,
    'function HistoryPickCard({ pick, sport, viewingToday }: { pick: EzpzPick; sport: Sport; viewingToday: boolean }) {',
    'function HistoryPickCard({ pick, sport, viewingToday, data }: { pick: EzpzPick; sport: Sport; viewingToday: boolean; data: FootballData }) {',
    "HistoryPickCard signature",
)

text = replace_once(
    text,
    '''      ) : (
        <div className="footballHistoryGameHero">
          <span><MatchupWithLogos sport={sport} game={pick.game || ""} compact /></span>
          <h3><SelectionWithTeamLogo sport={sport} selection={pick.selection || ""} game={pick.game || ""} /></h3>
          <p>{pick.market || "Model Play"}</p>
        </div>
      )}
    </article>''',
    '''      ) : (
        <div className="footballHistoryGameHero">
          <span><MatchupWithLogos sport={sport} game={pick.game || ""} compact /></span>
          <h3><SelectionWithTeamLogo sport={sport} selection={pick.selection || ""} game={pick.game || ""} /></h3>
          <p>{pick.market || "Model Play"}</p>
        </div>
      )}
      {!isProp && pick.source !== "Trend Play" ? (
        <FootballModelFormBadges
          rows={data.betTrackerRows || []}
          today={data.today}
          grade={pick.tier || pick.formType || pick.qualification}
          market={pick.market}
          selection={pick.selection}
          recordType={pick.formType}
          qualification={pick.qualification}
          className="footballHistoryFormBadges"
        />
      ) : null}
    </article>''',
    "HistoryPickCard form rendering",
)

text = replace_once(
    text,
    '<HistoryPickCard key={`${pickIdentity(pick)}-${index}`} pick={pick} sport={sport} viewingToday={viewingToday} />',
    '<HistoryPickCard key={`${pickIdentity(pick)}-${index}`} pick={pick} sport={sport} viewingToday={viewingToday} data={data} />',
    "HistoryPickCard invocation",
)
path.write_text(text)
