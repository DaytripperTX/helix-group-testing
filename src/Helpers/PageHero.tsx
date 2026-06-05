type PageHeroProps = {
  eyebrow: string;
  title: string;
  text: string;
};

function PageHero({ eyebrow, title, text }: PageHeroProps) {
  return (
    <section className="page-hero" aria-labelledby={`${title}-title`}>
      <div className="section__content page-hero__content">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id={`${title}-title`}>{title}</h1>
        <p>{text}</p>
      </div>
    </section>
  );
}

export default PageHero;
