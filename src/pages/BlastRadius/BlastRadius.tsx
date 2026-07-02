import ComingSoon from '../../components/ComingSoon';

/**
 * BlastRadius — placeholder/locked tab for v2.
 * Present in nav for roadmap visibility but not functional yet.
 */
export default function BlastRadius() {
  return (
    <ComingSoon
      title="Blast Radius"
      description="Disruption simulation showing cascading impact across your supply chain, with financial exposure calculations and generated mitigation roadmaps."
      featureHighlights={[
        'Select a disrupted entity + scenario duration',
        'Radial/tree visualization with hop-distance ordering',
        'Color-coded severity per downstream entity',
        'Financial exposure per affected order/contract',
        'Generated mitigation action sequence',
      ]}
    />
  );
}
