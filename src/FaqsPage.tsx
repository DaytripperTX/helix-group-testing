import { useEffect, useState } from 'react';
import PageHero from './Helpers/PageHero';

type FaqItem = {
  question: string;
  answer: string;
};

function FaqsPage() {
  const [faqItems, setFaqItems] = useState<FaqItem[]>([]);
  const [faqStatus, setFaqStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let isMounted = true;

    fetch('/faqs.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Unable to load FAQs');
        }

        return response.json() as Promise<FaqItem[]>;
      })
      .then((items) => {
        if (isMounted) {
          setFaqItems(items);
          setFaqStatus('ready');
        }
      })
      .catch(() => {
        if (isMounted) {
          setFaqStatus('error');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <>
      <PageHero
        eyebrow="FAQs"
        title="Common questions"
        text="Answers to common questions about vendor-direct payment, delivery, testing coordination, and site boundaries."
      />

      <section className="section" aria-labelledby="faq-title">
        <div className="section__content">
          <div className="section__header">
            <p className="eyebrow">Reference</p>
            <h2 id="faq-title">Participation FAQ</h2>
            <p>
              These answers summarize the current participation and testing
              workflow. Details may be refined as the site evolves.
            </p>
          </div>

          {faqStatus === 'loading' && <p className="note">Loading FAQs...</p>}
          {faqStatus === 'error' && (
            <p className="note">FAQs could not be loaded. Please try again later.</p>
          )}
          {faqStatus === 'ready' && (
            <div className="faq-list">
              {faqItems.map((item) => (
                <details className="faq-item" key={item.question}>
                  <summary>{item.question}</summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

export default FaqsPage;
