import { type FormEvent, useState } from 'react';
import PageHero from './Helpers/PageHero';

type LabelFormData = {
  peptideName: string;
  massMg: string;
  batchNumber: string;
  vendor: string;
  purity: string;
  vialSize: string;
  expirationDate: string;
  coaLink: string;
};

type LabelTemplate = {
  id: string;
  name: string;
  author: string;
  peptideTypes: string[];
  generic: boolean;
  featured: boolean;
  editable: boolean;
  votes: number;
  style: 'clinical' | 'dark' | 'safety';
  description: string;
};

type UploadedLabelForm = {
  name: string;
  author: string;
  peptideType: string;
  generic: boolean;
};

const labelPeptideTypes = [
  'BPC-157',
  'TB-500',
  'Tirzepatide',
  'Retatrutide',
  'Semaglutide',
  'GHK-Cu',
  'NAD+',
  'KPV',
  'Generic',
] as const;

const labelFormDefaults: LabelFormData = {
  peptideName: 'BPC-157',
  massMg: '10',
  batchNumber: 'HX-BPC-10-A',
  vendor: 'Vendor Direct',
  purity: '99.2%',
  vialSize: '3 mL',
  expirationDate: '2027-06-05',
  coaLink: '',
};

const labelFieldLabels: Record<keyof LabelFormData, string> = {
  peptideName: 'Peptide name',
  massMg: 'Mass (mg)',
  batchNumber: 'Batch #',
  vendor: 'Vendor',
  purity: 'Purity',
  vialSize: 'Vial size',
  expirationDate: 'Expiration date',
  coaLink: 'COA link',
};

const labelTemplates: LabelTemplate[] = [
  {
    id: 'clinical-strip',
    name: 'Clinical Strip',
    author: 'Helix Starter',
    peptideTypes: ['Generic'],
    generic: true,
    featured: true,
    editable: true,
    votes: 128,
    style: 'clinical',
    description: 'Clean lab label with high contrast rows and optional COA QR.',
  },
  {
    id: 'night-batch',
    name: 'Night Batch',
    author: 'Helix Starter',
    peptideTypes: ['BPC-157', 'TB-500', 'Tirzepatide'],
    generic: false,
    featured: true,
    editable: true,
    votes: 94,
    style: 'dark',
    description: 'Dark header template built for peptide name and mass-first scanning.',
  },
  {
    id: 'safety-band',
    name: 'Safety Band',
    author: 'Helix Starter',
    peptideTypes: ['Generic'],
    generic: true,
    featured: false,
    editable: true,
    votes: 63,
    style: 'safety',
    description: 'Utility label with a left color band and compact field stack.',
  },
];

function LabelsPage() {
  const [selectedTemplateId, setSelectedTemplateId] = useState(labelTemplates[0].id);
  const [selectedPeptideType, setSelectedPeptideType] = useState<'all' | string>('all');
  const [labelFormData, setLabelFormData] = useState<LabelFormData>(labelFormDefaults);
  const [uploadedTemplates, setUploadedTemplates] = useState<LabelTemplate[]>([]);
  const [localVotes, setLocalVotes] = useState<Record<string, boolean>>({});
  const [uploadForm, setUploadForm] = useState<UploadedLabelForm>({
    name: '',
    author: '',
    peptideType: 'Generic',
    generic: true,
  });

  const allTemplates = [...labelTemplates, ...uploadedTemplates];
  const selectedTemplate =
    allTemplates.find((template) => template.id === selectedTemplateId) ?? allTemplates[0];
  const generatedSvg = renderLabelSvg(selectedTemplate, labelFormData);
  const filteredTemplates = allTemplates.filter((template) => {
    if (selectedPeptideType === 'all') {
      return true;
    }

    if (selectedPeptideType === 'Generic') {
      return template.generic;
    }

    return template.generic || template.peptideTypes.includes(selectedPeptideType);
  });
  const featuredTemplates = allTemplates
    .filter((template) => template.featured || localVotes[template.id])
    .sort((first, second) => getTemplateVotes(second, localVotes) - getTemplateVotes(first, localVotes))
    .slice(0, 4);

  const updateLabelField = (field: keyof LabelFormData, value: string) => {
    setLabelFormData((currentData) => ({
      ...currentData,
      [field]: value,
    }));
  };

  const uploadTemplate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const cleanName = uploadForm.name.trim();
    if (!cleanName) {
      return;
    }

    const peptideTypes = uploadForm.generic ? ['Generic'] : [uploadForm.peptideType];
    const uploadedTemplate: LabelTemplate = {
      id: `community-${Date.now()}`,
      name: cleanName,
      author: uploadForm.author.trim() || 'Community member',
      peptideTypes,
      generic: uploadForm.generic,
      featured: false,
      editable: true,
      votes: 0,
      style: 'clinical',
      description: 'Community-submitted SVG template awaiting review and votes.',
    };

    setUploadedTemplates((currentTemplates) => [uploadedTemplate, ...currentTemplates]);
    setSelectedTemplateId(uploadedTemplate.id);
    setUploadForm({
      name: '',
      author: '',
      peptideType: 'Generic',
      generic: true,
    });
  };

  const downloadGeneratedSvg = () => {
    const blob = new Blob([generatedSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const fileName = `${labelFormData.peptideName || selectedTemplate.name}`
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    link.href = url;
    link.download = `${fileName || 'vial-label'}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHero
        eyebrow="Label Library"
        title="Vial label generator"
        text="Choose editable SVG templates, filter by peptide type, fill common vial fields, and include an optional COA QR code for printable labels."
      />

      <section className="label-page" aria-labelledby="label-library-title">
        <div className="label-page__layout">
          <aside className="label-panel label-library" aria-label="Label template library">
            <div>
              <p className="eyebrow">Library</p>
              <h2 id="label-library-title">Templates</h2>
            </div>

            <label className="label-field">
              <span>Peptide filter</span>
              <select
                value={selectedPeptideType}
                onChange={(event) => setSelectedPeptideType(event.target.value)}
              >
                <option value="all">All labels</option>
                {labelPeptideTypes.map((peptideType) => (
                  <option value={peptideType} key={peptideType}>
                    {peptideType}
                  </option>
                ))}
              </select>
            </label>

            <div className="label-template-list">
              {filteredTemplates.map((template) => (
                <LabelTemplateCard
                  template={template}
                  isSelected={template.id === selectedTemplate.id}
                  votes={getTemplateVotes(template, localVotes)}
                  isVoted={localVotes[template.id] ?? false}
                  key={template.id}
                  onSelect={() => setSelectedTemplateId(template.id)}
                  onVote={() =>
                    setLocalVotes((currentVotes) => ({
                      ...currentVotes,
                      [template.id]: !currentVotes[template.id],
                    }))
                  }
                />
              ))}
            </div>
          </aside>

          <section className="label-generator" aria-labelledby="label-generator-title">
            <div className="label-generator__header">
              <div>
                <p className="eyebrow">Generator</p>
                <h2 id="label-generator-title">{selectedTemplate.name}</h2>
                <p>{selectedTemplate.description}</p>
              </div>
              <button className="label-primary-action" type="button" onClick={downloadGeneratedSvg}>
                Download SVG
              </button>
            </div>

            <div className="label-preview-shell">
              <div
                className="label-preview"
                aria-label="Generated vial label preview"
                dangerouslySetInnerHTML={{ __html: generatedSvg }}
              />
            </div>

            <div className="featured-labels" aria-label="Featured community labels">
              <div>
                <p className="eyebrow">Featured Queue</p>
                <h3>Community picks</h3>
              </div>
              <div className="featured-labels__grid">
                {featuredTemplates.map((template) => (
                  <button
                    className="featured-label"
                    type="button"
                    key={template.id}
                    onClick={() => setSelectedTemplateId(template.id)}
                  >
                    <strong>{template.name}</strong>
                    <span>{getTemplateVotes(template, localVotes)} votes</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <aside className="label-panel label-controls" aria-label="Label generator fields">
            <form className="label-form">
              <div>
                <p className="eyebrow">Fill Label</p>
                <h2>Fields</h2>
              </div>

              {(
                [
                  'peptideName',
                  'massMg',
                  'batchNumber',
                  'vendor',
                  'purity',
                  'vialSize',
                  'expirationDate',
                ] as (keyof LabelFormData)[]
              ).map((field) => (
                <label className="label-field" key={field}>
                  <span>{labelFieldLabels[field]}</span>
                  <input
                    type={field === 'expirationDate' ? 'date' : 'text'}
                    value={labelFormData[field]}
                    onChange={(event) => updateLabelField(field, event.target.value)}
                  />
                </label>
              ))}

              <label className="label-field">
                <span>{labelFieldLabels.coaLink}</span>
                <input
                  type="url"
                  value={labelFormData.coaLink}
                  placeholder="https://..."
                  onChange={(event) => updateLabelField('coaLink', event.target.value)}
                />
              </label>
            </form>

            <form className="label-upload" onSubmit={uploadTemplate}>
              <div>
                <p className="eyebrow">Upload</p>
                <h2>Share a template</h2>
              </div>

              <label className="label-field">
                <span>Template SVG</span>
                <input type="file" accept=".svg,image/svg+xml" />
              </label>

              <label className="label-field">
                <span>Template name</span>
                <input
                  type="text"
                  value={uploadForm.name}
                  onChange={(event) =>
                    setUploadForm((currentForm) => ({
                      ...currentForm,
                      name: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="label-field">
                <span>Author</span>
                <input
                  type="text"
                  value={uploadForm.author}
                  onChange={(event) =>
                    setUploadForm((currentForm) => ({
                      ...currentForm,
                      author: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="label-toggle">
                <input
                  type="checkbox"
                  checked={uploadForm.generic}
                  onChange={(event) =>
                    setUploadForm((currentForm) => ({
                      ...currentForm,
                      generic: event.target.checked,
                    }))
                  }
                />
                <span>Generic label</span>
              </label>

              {!uploadForm.generic && (
                <label className="label-field">
                  <span>Peptide type</span>
                  <select
                    value={uploadForm.peptideType}
                    onChange={(event) =>
                      setUploadForm((currentForm) => ({
                        ...currentForm,
                        peptideType: event.target.value,
                      }))
                    }
                  >
                    {labelPeptideTypes
                      .filter((peptideType) => peptideType !== 'Generic')
                      .map((peptideType) => (
                        <option value={peptideType} key={peptideType}>
                          {peptideType}
                        </option>
                      ))}
                  </select>
                </label>
              )}

              <button className="label-primary-action" type="submit">
                Add to Library
              </button>
            </form>
          </aside>
        </div>
      </section>
    </>
  );
}

function LabelTemplateCard({
  template,
  isSelected,
  votes,
  isVoted,
  onSelect,
  onVote,
}: {
  template: LabelTemplate;
  isSelected: boolean;
  votes: number;
  isVoted: boolean;
  onSelect: () => void;
  onVote: () => void;
}) {
  return (
    <article className={isSelected ? 'label-template is-selected' : 'label-template'}>
      <button className="label-template__preview" type="button" onClick={onSelect}>
        <span dangerouslySetInnerHTML={{ __html: renderLabelSvg(template, labelFormDefaults) }} />
      </button>
      <div className="label-template__body">
        <div>
          <h3>{template.name}</h3>
          <p>{template.author}</p>
        </div>
        <div className="label-template__tags">
          {template.generic && <span>Generic</span>}
          {template.featured && <span>Featured</span>}
          {template.editable && <span>Editable</span>}
        </div>
        <button
          className={isVoted ? 'label-vote is-voted' : 'label-vote'}
          type="button"
          aria-pressed={isVoted}
          onClick={onVote}
        >
          {votes} votes
        </button>
      </div>
    </article>
  );
}

function getTemplateVotes(template: LabelTemplate, localVotes: Record<string, boolean>) {
  return template.votes + (localVotes[template.id] ? 1 : 0);
}

function renderLabelSvg(template: LabelTemplate, data: LabelFormData) {
  const labelRows = getLabelRows(data);
  const peptideName = data.peptideName.trim();
  const mass = data.massMg.trim();
  const coaLink = data.coaLink.trim();
  const qrImage = coaLink
    ? `<image href="${escapeSvgAttribute(
        `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=1&data=${encodeURIComponent(
          coaLink,
        )}`,
      )}" x="57" y="18" width="10" height="10" preserveAspectRatio="none" /><rect x="57" y="18" width="10" height="10" fill="none" stroke="#07101f" stroke-width=".25" /><text x="62" y="30.5" text-anchor="middle" font-size="1.55" font-family="Inter, Arial, sans-serif" font-weight="800" fill="#344154">COA</text>`
    : '';
  const rowLimit = coaLink ? 42 : 55;
  const rowsSvg = labelRows
    .map(
      (row, index) =>
        `<text x="5" y="${14 + index * 2.8}" font-size="1.95" font-family="Inter, Arial, sans-serif" fill="#344154"><tspan font-weight="800">${escapeSvgText(
          row.label,
        )}</tspan><tspan dx="1.1" fill="#07101f">${escapeSvgText(
          truncateLabelText(row.value, rowLimit),
        )}</tspan></text>`,
    )
    .join('');

  if (template.style === 'dark') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="70mm" height="32mm" viewBox="0 0 70 32" role="img" aria-label="Generated vial label">
  <rect width="70" height="32" rx="2" fill="#f7fafc" />
  <rect width="70" height="10.8" rx="2" fill="#07101f" />
  <rect y="9" width="70" height="1.8" fill="#13f4ff" />
  ${peptideName ? `<text x="5" y="6.8" font-size="4.6" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#ffffff">${escapeSvgText(truncateLabelText(peptideName, 22))}</text>` : ''}
  ${mass ? `<text x="64" y="6.6" text-anchor="end" font-size="3.2" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#13f4ff">${escapeSvgText(truncateLabelText(`${mass} mg`, 10))}</text>` : ''}
  ${rowsSvg}
  ${qrImage}
</svg>`;
  }

  if (template.style === 'safety') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="70mm" height="32mm" viewBox="0 0 70 32" role="img" aria-label="Generated vial label">
  <rect width="70" height="32" rx="2" fill="#fffefd" />
  <rect width="7.4" height="32" fill="#e8b943" />
  <rect x="9.8" y="3.4" width="36" height="5.8" rx="1.2" fill="#07101f" />
  ${peptideName ? `<text x="12" y="7.6" font-size="3.3" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#ffffff">${escapeSvgText(truncateLabelText(peptideName, 20))}</text>` : ''}
  ${mass ? `<text x="50" y="7.6" font-size="3.1" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#9b5526">${escapeSvgText(truncateLabelText(`${mass} mg`, 11))}</text>` : ''}
  ${rowsSvg}
  ${qrImage}
</svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="70mm" height="32mm" viewBox="0 0 70 32" role="img" aria-label="Generated vial label">
  <rect width="70" height="32" rx="2" fill="#ffffff" />
  <rect x="0" y="0" width="70" height="5.6" fill="#13f4ff" />
  <rect x="0" y="5.6" width="70" height=".8" fill="#07101f" />
  ${peptideName ? `<text x="5" y="10.5" font-size="4" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#07101f">${escapeSvgText(truncateLabelText(peptideName, 24))}</text>` : ''}
  ${mass ? `<rect x="49" y="7.4" width="17" height="5" rx="1.4" fill="#eafbff" stroke="#00aeb8" stroke-width=".35" /><text x="57.5" y="10.9" text-anchor="middle" font-size="2.7" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#006f78">${escapeSvgText(truncateLabelText(`${mass} mg`, 9))}</text>` : ''}
  ${rowsSvg}
  ${qrImage}
</svg>`;
}

function getLabelRows(data: LabelFormData) {
  return [
    { label: 'Mass', value: data.massMg.trim() ? `${data.massMg.trim()} mg` : '' },
    { label: 'Batch', value: data.batchNumber.trim() },
    { label: 'Vendor', value: data.vendor.trim() },
    { label: 'Purity', value: data.purity.trim() },
    { label: 'Vial', value: data.vialSize.trim() },
    { label: 'Exp', value: data.expirationDate.trim() },
  ].filter((row) => row.value.length > 0);
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeSvgAttribute(value: string) {
  return escapeSvgText(value).replace(/"/g, '&quot;');
}

function truncateLabelText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

export default LabelsPage;
