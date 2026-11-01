export default function TalkTrack({ talk }) {
  return (
    <section className="panel" aria-label="Talk track">
      <h2 className="panel__title">Talk track</h2>
      <ol className="talk" data-testid="talk-track">
        {talk.map((t) => <li key={t.id}><h3>{t.title}</h3><p>{t.say}</p></li>)}
      </ol>
    </section>
  );
}
