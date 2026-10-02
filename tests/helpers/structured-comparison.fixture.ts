// Synthetic evidence for format/receipt regressions, not a real provider's terms.
export const comparisonOptions = ['Residential care', 'Detox support', 'Outpatient care'];
export const comparisonQualifications = 'Insurance requires individual benefits verification. Give advance notice for accommodation needs, including sign language interpretation. Current availability is unknown; contact admissions.';
export const comparisonProse = `${comparisonOptions.map(name => `- ${name}: see the published description.`).join('\n')}\n\n${comparisonQualifications}\n\nThe structured comparison view has not been opened.`;
export const comparisonTable = `| Option | Published description |\n| --- | --- |\n| Residential care | A residential program. |\n| Detox support | A detox program. |\n| Outpatient care | An outpatient program. |\n\n${comparisonQualifications}`;
