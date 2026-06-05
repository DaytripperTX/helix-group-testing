import { useState } from 'react';
import DisclaimerSection from './Helpers/DisclaimerSection';

const orderTestingTiers = [
  { id: 'platinum', name: 'Platinum', label: '7x Testing' },
  { id: 'gold', name: 'Gold', label: '5x Testing' },
  { id: 'bronze', name: 'Bronze', label: '2x Testing' },
] as const;

type TestingTierId = (typeof orderTestingTiers)[number]['id'];
type OrderPeptide = {
  id: string;
  shorthand: string;
  fullName: string;
  supplierCode: string;
  massMg: number;
  price: number;
  tier: TestingTierId;
  headcount: number;
  totalOrdered: number;
  upgradeGoal: number;
  upgradePledged: number;
};
type ContactInfo = {
  name: string;
  address: string;
  phone: string;
};
type OrderDialogStep = 'contact' | 'message';
type SelectedOrderPeptide = OrderPeptide & {
  quantity: number;
};

const bulkDiscountRate = 0.15;
const maxOrderQuantity = 999;

const testingTierLookup = orderTestingTiers.reduce(
  (accumulator, tier) => ({
    ...accumulator,
    [tier.id]: tier,
  }),
  {} as Record<TestingTierId, (typeof orderTestingTiers)[number]>,
);

const orderPeptides: OrderPeptide[] = [
  {
    id: 'reta-30',
    shorthand: 'RETA',
    fullName: 'Retatrutide',
    supplierCode: 'HX-RET-30',
    massMg: 30,
    price: 285,
    tier: 'platinum',
    headcount: 18,
    totalOrdered: 44,
    upgradeGoal: 0,
    upgradePledged: 0,
  },
  {
    id: 'bpc-10',
    shorthand: 'BPC',
    fullName: 'BPC-157',
    supplierCode: 'HX-BPC-10',
    massMg: 10,
    price: 42,
    tier: 'platinum',
    headcount: 26,
    totalOrdered: 82,
    upgradeGoal: 0,
    upgradePledged: 0,
  },
  {
    id: 'klow-80',
    shorthand: 'KLOW',
    fullName: 'Kisspeptin-10 Low Endotoxin',
    supplierCode: 'HX-KLW-80',
    massMg: 80,
    price: 118,
    tier: 'gold',
    headcount: 9,
    totalOrdered: 18,
    upgradeGoal: 425,
    upgradePledged: 120,
  },
  {
    id: 'mots-40',
    shorthand: 'MOTS',
    fullName: 'MOTS-c',
    supplierCode: 'HX-MOT-40',
    massMg: 40,
    price: 96,
    tier: 'bronze',
    headcount: 12,
    totalOrdered: 24,
    upgradeGoal: 650,
    upgradePledged: 210,
  },
  {
    id: 'ss31-10',
    shorthand: 'SS-31',
    fullName: 'Elamipretide SS-31',
    supplierCode: 'HX-SS31-10',
    massMg: 10,
    price: 78,
    tier: 'gold',
    headcount: 11,
    totalOrdered: 19,
    upgradeGoal: 425,
    upgradePledged: 75,
  },
  {
    id: 'tirz-15',
    shorthand: 'TIRZ',
    fullName: 'Tirzepatide',
    supplierCode: 'HX-TIR-15',
    massMg: 15,
    price: 115,
    tier: 'platinum',
    headcount: 22,
    totalOrdered: 51,
    upgradeGoal: 0,
    upgradePledged: 0,
  },
  {
    id: 'cjcipa-10',
    shorthand: 'CJC/IP',
    fullName: 'CJC-1295 / Ipamorelin',
    supplierCode: 'HX-CJI-10',
    massMg: 10,
    price: 58,
    tier: 'gold',
    headcount: 15,
    totalOrdered: 31,
    upgradeGoal: 425,
    upgradePledged: 260,
  },
  {
    id: 'tesa-20',
    shorthand: 'TESA',
    fullName: 'Tesamorelin',
    supplierCode: 'HX-TES-20',
    massMg: 20,
    price: 128,
    tier: 'bronze',
    headcount: 8,
    totalOrdered: 14,
    upgradeGoal: 650,
    upgradePledged: 90,
  },
  {
    id: 'semax-5',
    shorthand: 'SEMAX',
    fullName: 'Semax',
    supplierCode: 'HX-SEM-05',
    massMg: 5,
    price: 34,
    tier: 'gold',
    headcount: 7,
    totalOrdered: 16,
    upgradeGoal: 425,
    upgradePledged: 40,
  },
  {
    id: 'selank-5',
    shorthand: 'SELANK',
    fullName: 'Selank',
    supplierCode: 'HX-SEL-05',
    massMg: 5,
    price: 32,
    tier: 'gold',
    headcount: 10,
    totalOrdered: 21,
    upgradeGoal: 425,
    upgradePledged: 155,
  },
  {
    id: 'nad-500',
    shorthand: 'NAD+',
    fullName: 'NAD+',
    supplierCode: 'HX-NAD-500',
    massMg: 500,
    price: 72,
    tier: 'platinum',
    headcount: 16,
    totalOrdered: 38,
    upgradeGoal: 0,
    upgradePledged: 0,
  },
  {
    id: 'kpv-10',
    shorthand: 'KPV',
    fullName: 'KPV',
    supplierCode: 'HX-KPV-10',
    massMg: 10,
    price: 46,
    tier: 'gold',
    headcount: 13,
    totalOrdered: 27,
    upgradeGoal: 425,
    upgradePledged: 185,
  },
  {
    id: 'tb500-10',
    shorthand: 'TB-500',
    fullName: 'TB-500',
    supplierCode: 'HX-TB5-10',
    massMg: 10,
    price: 54,
    tier: 'platinum',
    headcount: 19,
    totalOrdered: 46,
    upgradeGoal: 0,
    upgradePledged: 0,
  },
  {
    id: 'ghkcu-50',
    shorthand: 'GHKCU',
    fullName: 'GHK-Cu',
    supplierCode: 'HX-GHK-50',
    massMg: 50,
    price: 62,
    tier: 'gold',
    headcount: 14,
    totalOrdered: 29,
    upgradeGoal: 425,
    upgradePledged: 315,
  },
  {
    id: 'aod-10',
    shorthand: 'AOD',
    fullName: 'AOD-9604',
    supplierCode: 'HX-AOD-10',
    massMg: 10,
    price: 45,
    tier: 'bronze',
    headcount: 6,
    totalOrdered: 11,
    upgradeGoal: 650,
    upgradePledged: 60,
  },
  {
    id: 'pt141-10',
    shorthand: 'PT-141',
    fullName: 'PT-141',
    supplierCode: 'HX-PT1-10',
    massMg: 10,
    price: 38,
    tier: 'gold',
    headcount: 9,
    totalOrdered: 20,
    upgradeGoal: 425,
    upgradePledged: 130,
  },
];

const massFilters = [
  { id: 'all', label: 'All masses' },
  { id: 'small', label: '5-10 mg' },
  { id: 'medium', label: '15-50 mg' },
  { id: 'large', label: '80+ mg' },
] as const;

type MassFilterId = (typeof massFilters)[number]['id'];

function OrderFormPage() {
  const [selectedTierIds, setSelectedTierIds] = useState<Set<TestingTierId>>(
    () => new Set(orderTestingTiers.map((tier) => tier.id)),
  );
  const [massFilter, setMassFilter] = useState<MassFilterId>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [peptideQuantities, setPeptideQuantities] = useState<Record<string, number>>({});
  const [isOrderDialogOpen, setIsOrderDialogOpen] = useState(false);
  const [orderDialogStep, setOrderDialogStep] = useState<OrderDialogStep>('contact');
  const [contactInfo, setContactInfo] = useState<ContactInfo>({
    name: '',
    address: '',
    phone: '',
  });
  const [copyStatus, setCopyStatus] = useState('');

  const filteredPeptides = orderPeptides.filter((peptide) => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const matchesTier = selectedTierIds.has(peptide.tier);
    const matchesSearch =
      normalizedSearch.length === 0 ||
      peptide.fullName.toLowerCase().includes(normalizedSearch) ||
      peptide.supplierCode.toLowerCase().includes(normalizedSearch) ||
      peptide.shorthand.toLowerCase().includes(normalizedSearch);
    const matchesMass =
      massFilter === 'all' ||
      (massFilter === 'small' && peptide.massMg >= 5 && peptide.massMg <= 10) ||
      (massFilter === 'medium' && peptide.massMg >= 15 && peptide.massMg <= 50) ||
      (massFilter === 'large' && peptide.massMg >= 80);

    return matchesTier && matchesSearch && matchesMass;
  });

  const selectedPeptides = orderPeptides
    .map((peptide) => ({
      ...peptide,
      quantity: peptideQuantities[peptide.id] ?? 0,
    }))
    .filter((peptide) => peptide.quantity > 0);
  const vendorMessage = buildVendorMessage(contactInfo, selectedPeptides);
  const isContactComplete =
    contactInfo.name.trim().length > 0 &&
    contactInfo.address.trim().length > 0 &&
    contactInfo.phone.trim().length > 0;
  const selectedItemCount = selectedPeptides.reduce(
    (total, peptide) => total + peptide.quantity,
    0,
  );
  const selectedOriginalTotal = selectedPeptides.reduce(
    (total, peptide) => total + peptide.price * peptide.quantity,
    0,
  );
  const selectedTotal = selectedPeptides.reduce(
    (total, peptide) => total + getDiscountedPrice(peptide.price) * peptide.quantity,
    0,
  );

  const toggleTierFilter = (tierId: TestingTierId) => {
    setSelectedTierIds((currentTierIds) => {
      const nextTierIds = new Set(currentTierIds);

      if (nextTierIds.has(tierId)) {
        nextTierIds.delete(tierId);
      } else {
        nextTierIds.add(tierId);
      }

      return nextTierIds;
    });
  };

  const setPeptideQuantity = (peptideId: string, quantity: number) => {
    const normalizedQuantity = Math.min(
      maxOrderQuantity,
      Math.max(0, Math.trunc(Number.isFinite(quantity) ? quantity : 0)),
    );

    setPeptideQuantities((currentQuantities) => {
      const nextQuantities = { ...currentQuantities };

      if (normalizedQuantity === 0) {
        delete nextQuantities[peptideId];
      } else {
        nextQuantities[peptideId] = normalizedQuantity;
      }

      return nextQuantities;
    });
  };

  const openOrderDialog = () => {
    setOrderDialogStep('contact');
    setCopyStatus('');
    setIsOrderDialogOpen(true);
  };

  const closeOrderDialog = () => {
    setIsOrderDialogOpen(false);
    setCopyStatus('');
  };

  const updateContactInfo = (field: keyof ContactInfo, value: string) => {
    setContactInfo((currentInfo) => ({
      ...currentInfo,
      [field]: value,
    }));
    setCopyStatus('');
  };

  const copyVendorMessage = async () => {
    try {
      await navigator.clipboard.writeText(vendorMessage);
      setCopyStatus('Copied');
    } catch {
      setCopyStatus('Copy manually');
    }
  };

  return (
    <>
      <section className="order-page" aria-labelledby="order-form-title">
        <div className="order-page__layout">
          <aside className="order-filters" aria-label="Peptide filters">
            <div>
              <p className="eyebrow">Filters</p>
              <h1 id="order-form-title">Order Form</h1>
            </div>

            <label className="filter-search">
              <span>Search</span>
              <input
                type="search"
                value={searchTerm}
                placeholder="Name or code"
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>

            <fieldset className="filter-group">
              <legend>Testing tier</legend>
              {orderTestingTiers.map((tier) => (
                <label className={`filter-check filter-check--${tier.id}`} key={tier.id}>
                  <input
                    type="checkbox"
                    checked={selectedTierIds.has(tier.id)}
                    onChange={() => toggleTierFilter(tier.id)}
                  />
                  <span>{tier.name}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="filter-group">
              <legend>Mass</legend>
              <div className="mass-filter-list">
                {massFilters.map((filter) => (
                  <button
                    className={massFilter === filter.id ? 'mass-filter is-selected' : 'mass-filter'}
                    type="button"
                    key={filter.id}
                    aria-pressed={massFilter === filter.id}
                    onClick={() => setMassFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </aside>

          <section className="peptide-shop" aria-label="Peptides list">
            <div className="peptide-shop__header">
              <div>
                <p className="eyebrow">Current round</p>
                <h2>Peptides List</h2>
              </div>
              <span>{filteredPeptides.length} shown</span>
            </div>

            <div className="peptide-grid">
              {filteredPeptides.map((peptide) => (
                <PeptideCard
                  peptide={peptide}
                  quantity={peptideQuantities[peptide.id] ?? 0}
                  onQuantityChange={(quantity) => setPeptideQuantity(peptide.id, quantity)}
                  key={peptide.id}
                />
              ))}
            </div>

            {filteredPeptides.length === 0 && (
              <p className="empty-state">No peptides match the current filters.</p>
            )}
          </section>

          <aside className="order-summary" aria-label="Your order">
            <div>
              <p className="eyebrow">Your Order</p>
              <h2>{formatCurrency(selectedTotal)}</h2>
            </div>

            <div className="order-summary__meta">
              <span>{selectedItemCount} total vials</span>
              <span>{selectedPeptides.length} peptides</span>
              <span>Vendor direct</span>
            </div>

            <div className="order-summary__items">
              {selectedPeptides.map((peptide) => (
                <div className="order-line" key={peptide.id}>
                  <div>
                    <strong>{peptide.fullName}</strong>
                    <span className="order-line__meta">
                      <span>{peptide.supplierCode}</span>
                      <span>{peptide.massMg} mg</span>
                      <span>Qty {peptide.quantity}</span>
                    </span>
                  </div>
                  <em>{formatCurrency(getDiscountedPrice(peptide.price) * peptide.quantity)}</em>
                </div>
              ))}

              {selectedPeptides.length === 0 && (
                <p className="empty-state">Select peptides to build a running total.</p>
              )}
            </div>

            <div className="order-summary__total">
              <span>Original</span>
              <s>{formatCurrency(selectedOriginalTotal)}</s>
            </div>

            <div className="order-summary__total order-summary__total--discounted">
              <span>Bulk total</span>
              <strong>{formatCurrency(selectedTotal)}</strong>
            </div>

            <button
              className="order-submit"
              type="button"
              disabled={selectedItemCount === 0}
              onClick={openOrderDialog}
            >
              Submit Interest
            </button>

            <p className="order-note">
              This records interest only. Payment and fulfillment remain directly between each
              participant and the vendor.
            </p>
          </aside>
        </div>
      </section>

      {isOrderDialogOpen && (
        <div className="order-dialog-backdrop" role="presentation">
          <section
            className="order-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-dialog-title"
          >
            <button
              className="order-dialog__close"
              type="button"
              aria-label="Close"
              onClick={closeOrderDialog}
            >
              x
            </button>

            {orderDialogStep === 'contact' && (
              <form
                className="order-dialog__content"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (isContactComplete) {
                    setOrderDialogStep('message');
                  }
                }}
              >
                <div>
                  <p className="eyebrow">Vendor Message</p>
                  <h2 id="order-dialog-title">Contact Info</h2>
                </div>

                <label className="order-dialog__field">
                  <span>Name</span>
                  <input
                    type="text"
                    value={contactInfo.name}
                    autoFocus
                    onChange={(event) => updateContactInfo('name', event.target.value)}
                  />
                </label>

                <label className="order-dialog__field">
                  <span>Address</span>
                  <textarea
                    rows={4}
                    value={contactInfo.address}
                    onChange={(event) => updateContactInfo('address', event.target.value)}
                  />
                </label>

                <label className="order-dialog__field">
                  <span>Phone</span>
                  <input
                    type="tel"
                    value={contactInfo.phone}
                    onChange={(event) => updateContactInfo('phone', event.target.value)}
                  />
                </label>

                <button className="order-dialog__primary" type="submit" disabled={!isContactComplete}>
                  Next
                </button>
              </form>
            )}

            {orderDialogStep === 'message' && (
              <div className="order-dialog__content">
                <div>
                  <p className="eyebrow">Ready to Copy</p>
                  <h2 id="order-dialog-title">Vendor Message</h2>
                </div>

                <textarea
                  className="vendor-message"
                  value={vendorMessage}
                  readOnly
                  rows={Math.min(14, selectedPeptides.length + 7)}
                />

                <div className="order-dialog__actions">
                  <button
                    className="order-dialog__secondary"
                    type="button"
                    onClick={() => {
                      setOrderDialogStep('contact');
                      setCopyStatus('');
                    }}
                  >
                    Back
                  </button>
                  <button className="order-dialog__primary" type="button" onClick={copyVendorMessage}>
                    Copy
                  </button>
                </div>

                {copyStatus && <p className="copy-status">{copyStatus}</p>}
              </div>
            )}
          </section>
        </div>
      )}

      <DisclaimerSection />
    </>
  );
}

function PeptideCard({
  peptide,
  quantity,
  onQuantityChange,
}: {
  peptide: OrderPeptide;
  quantity: number;
  onQuantityChange: (quantity: number) => void;
}) {
  const tier = testingTierLookup[peptide.tier];
  const discountedPrice = getDiscountedPrice(peptide.price);
  const [isInfoPinned, setIsInfoPinned] = useState(false);

  return (
    <article className={`peptide-card peptide-card--${peptide.tier}`}>
      <div className={isInfoPinned ? 'peptide-info is-pinned' : 'peptide-info'}>
        <button
          className="peptide-info__trigger"
          type="button"
          aria-label={`${peptide.fullName} details`}
          aria-expanded={isInfoPinned}
          onClick={() => setIsInfoPinned((currentValue) => !currentValue)}
        >
          i
        </button>
        <div className="peptide-info__panel">
          <dl>
            <div>
              <dt>Heads</dt>
              <dd>{peptide.headcount}</dd>
            </div>
            <div>
              <dt>Ordered</dt>
              <dd>{peptide.totalOrdered}</dd>
            </div>
          </dl>
          <div className="upgrade-pledge">
            {peptide.upgradeGoal > 0 ? (
              <>
                <button type="button">Fund Upgrade</button>
                <span>
                  {formatWholeCurrency(peptide.upgradePledged)} /{' '}
                  {formatWholeCurrency(peptide.upgradeGoal)}
                </span>
              </>
            ) : (
              <span>Top tier</span>
            )}
          </div>
        </div>
      </div>

      <div className="vial-preview" aria-hidden="true">
        <div className="vial-preview__art">
          <img src="/vial.svg" alt="" />
          <div className="vial-preview__label">
            <strong>{peptide.shorthand}</strong>
            <span>{peptide.massMg} MG</span>
          </div>
        </div>
      </div>

      <div className="peptide-card__body">
        <h3>{peptide.fullName}</h3>
        <dl>
          <div>
            <dt>Supplier code</dt>
            <dd>{peptide.supplierCode}</dd>
          </div>
          <div>
            <dt>Mass</dt>
            <dd>{peptide.massMg} mg</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd>
              <span className="price-pair">
                <s>{formatCurrency(peptide.price)}</s>
                <strong>{formatCurrency(discountedPrice)}</strong>
              </span>
            </dd>
          </div>
        </dl>
      </div>

      <div className="peptide-card__footer">
        <div>
          <span>{tier.name}</span>
          <strong>{tier.label}</strong>
        </div>
        <div className="quantity-control" aria-label={`${peptide.fullName} quantity`}>
          <button
            type="button"
            aria-label={`Decrease ${peptide.fullName} quantity`}
            onClick={() => onQuantityChange(quantity - 1)}
            disabled={quantity === 0}
          >
            -
          </button>
          <input
            type="number"
            min="0"
            max={maxOrderQuantity}
            value={quantity}
            aria-label={`${peptide.fullName} quantity`}
            onChange={(event) => onQuantityChange(event.target.valueAsNumber)}
          />
          <button
            type="button"
            aria-label={`Increase ${peptide.fullName} quantity`}
            onClick={() => onQuantityChange(quantity + 1)}
          >
            +
          </button>
        </div>
      </div>
    </article>
  );
}

function getDiscountedPrice(price: number) {
  return price * (1 - bulkDiscountRate);
}

function buildVendorMessage(contactInfo: ContactInfo, selectedPeptides: SelectedOrderPeptide[]) {
  const orderLines = selectedPeptides.map(
    (peptide) => `${peptide.supplierCode} x${peptide.quantity}`,
  );

  return [
    `Name: ${contactInfo.name.trim()}`,
    `Address: ${contactInfo.address.trim().replace(/\s+/g, ' ')}`,
    `Phone: ${contactInfo.phone.trim()}`,
    '',
    'Order:',
    ...orderLines,
  ].join('\n');
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatWholeCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export default OrderFormPage;
