/**
 * Radar Chart Component for Vendor-Job Matching Visualization
 * 
 * Displays a 7-sided (heptagon) radar chart showing how well a vendor's
 * capabilities match the job requirements. Uses actual API score breakdown factors.
 * 
 * 7 Factors from API:
 * - certification_match (25%)
 * - proximity (15%)
 * - rating (20%)
 * - completion_rate (15%)
 * - available_capacity (10%)
 * - response_time (10%)
 * - quality_(low_rework) (5%)
 * 
 * @requirement 5.2 - Display scores and rationale
 * @requirement 5.5 - Display confidence indicators
 */

import { useState } from 'react';

// Color scheme
const COLORS = {
  background: '#F0E0D0',
  backgroundLight: '#F8F0E8',
  border: '#383028',
  borderMedium: '#484038',
  accent: '#D8A850',
  grid: '#B5B5B5',
  gridLight: '#D0C8C0',
  text: '#383028',
  textLight: '#6B6358',
  jobPolygon: 'rgba(56, 48, 40, 0.15)',
  vendorPolygon: 'rgba(216, 168, 80, 0.6)',
};

// 7 factors matching API scoreBreakdown order (sorted by weight)
const FACTOR_COUNT = 7;
const factorLabels = ['Certification', 'Rating', 'Proximity', 'Completion', 'Capacity', 'Response', 'Quality'];

// SVG Icons for each of the 7 factors (in order)
const Icons: Record<string, JSX.Element> = {
  certification: <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />,
  rating: <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />,
  proximity: <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />,
  completion: <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />,
  capacity: <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z" />,
  response: <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" />,
  quality: <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />,
};

const iconKeys = ['certification', 'rating', 'proximity', 'completion', 'capacity', 'response', 'quality'];

interface RadarChartProps {
  vendorCapabilities: number[];
  jobRequirements: number[];
  labels: string[];
  weights: number[];
  size?: number;
}

/**
 * Calculate polygon points for 7-sided radar chart
 */
function calculatePolygonPoints(
  values: number[],
  centerX: number,
  centerY: number,
  radius: number
): string {
  const angleStep = (2 * Math.PI) / FACTOR_COUNT;
  const startAngle = -Math.PI / 2;

  return values
    .map((value, i) => {
      const angle = startAngle + i * angleStep;
      const x = centerX + Math.cos(angle) * radius * value;
      const y = centerY + Math.sin(angle) * radius * value;
      return `${x},${y}`;
    })
    .join(' ');
}

/**
 * Calculate icon positions around the 7-sided chart
 */
function calculateIconPositions(
  centerX: number,
  centerY: number,
  radius: number
): { x: number; y: number }[] {
  const angleStep = (2 * Math.PI) / FACTOR_COUNT;
  const startAngle = -Math.PI / 2;
  const iconRadius = radius + 24;

  return Array.from({ length: FACTOR_COUNT }, (_, i) => {
    const angle = startAngle + i * angleStep;
    return {
      x: centerX + Math.cos(angle) * iconRadius,
      y: centerY + Math.sin(angle) * iconRadius,
    };
  });
}

/**
 * Calculate weighted match percentage
 */
function calculateWeightedMatch(capabilities: number[], weights: number[]): number {
  let weightedSum = 0;
  let totalWeight = 0;
  
  for (let i = 0; i < capabilities.length; i++) {
    weightedSum += capabilities[i] * (weights[i] || 0);
    totalWeight += weights[i] || 0;
  }
  
  return totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;
}

/**
 * Tooltip component
 */
function IconTooltip({ 
  children, text, x, y, value, svgSize,
}: { 
  children: React.ReactNode; 
  text: string; 
  x: number; 
  y: number;
  value?: number;
  svgSize: number;
}) {
  const [isVisible, setIsVisible] = useState(false);
  
  const tooltipWidth = 65;
  const tooltipHeight = 22;
  
  let tooltipX = x - tooltipWidth / 2;
  let tooltipY = y - 28;
  
  if (tooltipX < 5) tooltipX = 5;
  if (tooltipX + tooltipWidth > svgSize - 5) tooltipX = svgSize - tooltipWidth - 5;
  if (tooltipY < 5) tooltipY = y + 18;

  return (
    <g
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      style={{ cursor: 'pointer' }}
    >
      {children}
      {isVisible && (
        <g>
          <rect
            x={tooltipX} y={tooltipY}
            width={tooltipWidth} height={tooltipHeight}
            rx={3} fill={COLORS.border} stroke={COLORS.accent} strokeWidth="1"
          />
          <text
            x={tooltipX + tooltipWidth / 2} y={tooltipY + 9}
            textAnchor="middle" fill={COLORS.accent} fontSize="8" fontWeight="600"
          >
            {text}
          </text>
          {value !== undefined && (
            <text
              x={tooltipX + tooltipWidth / 2} y={tooltipY + 17}
              textAnchor="middle" fill="white" fontSize="8"
            >
              {Math.round(value * 100)}%
            </text>
          )}
        </g>
      )}
    </g>
  );
}

/**
 * Toggle Switch Component
 */
function ToggleSwitch({ checked, onChange, label }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
      <div
        style={{
          position: 'relative', width: '32px', height: '18px',
          backgroundColor: checked ? COLORS.accent : COLORS.gridLight,
          borderRadius: '9px', border: `1px solid ${COLORS.border}`,
        }}
        onClick={() => onChange(!checked)}
      >
        <div style={{
          position: 'absolute', top: '2px', left: checked ? '16px' : '2px',
          width: '12px', height: '12px',
          backgroundColor: checked ? COLORS.background : COLORS.border,
          borderRadius: '50%', transition: 'left 0.2s',
        }} />
      </div>
      <span style={{ fontSize: '11px', fontWeight: 600, color: COLORS.text }}>{label}</span>
    </label>
  );
}

export function RadarChart({ vendorCapabilities, jobRequirements, labels, weights, size = 200 }: RadarChartProps) {
  const padding = 35;
  const svgSize = size + padding * 2;
  const centerX = svgSize / 2;
  const centerY = svgSize / 2 + 5;
  const radius = size / 2 - 10;

  const iconPositions = calculateIconPositions(centerX, centerY, radius);
  const matchPercentage = calculateWeightedMatch(vendorCapabilities, weights);

  // Generate heptagon grid lines
  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const gridLines = gridLevels.map(level => 
    calculatePolygonPoints(Array(FACTOR_COUNT).fill(level), centerX, centerY, radius)
  );

  // Generate axis lines
  const axisLines = Array.from({ length: FACTOR_COUNT }, (_, i) => {
    const angle = -Math.PI / 2 + i * (2 * Math.PI / FACTOR_COUNT);
    return {
      x2: centerX + Math.cos(angle) * radius,
      y2: centerY + Math.sin(angle) * radius,
    };
  });

  const vendorPolygon = calculatePolygonPoints(vendorCapabilities, centerX, centerY, radius);
  
  // Job requirements polygon (gray) - based on actual job requirements
  const jobRequirementsPolygon = calculatePolygonPoints(jobRequirements, centerX, centerY, radius);

  const matchColor = matchPercentage >= 80 ? '#4CAF50' : matchPercentage >= 60 ? COLORS.accent : '#E57373';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      {/* Legend at top left */}
      <div style={{
        display: 'flex', gap: '12px', fontSize: '9px', color: COLORS.textLight,
        marginBottom: '6px', alignSelf: 'flex-start', marginLeft: '10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '12px', height: '8px', backgroundColor: COLORS.jobPolygon, border: `1px dashed ${COLORS.borderMedium}` }} />
          <span>Job Required</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '12px', height: '8px', backgroundColor: COLORS.vendorPolygon, border: `1px solid ${COLORS.accent}` }} />
          <span>Vendor Score</span>
        </div>
      </div>
      
      {/* Chart centered */}
      <svg width={svgSize} height={svgSize} viewBox={`0 0 ${svgSize} ${svgSize}`}>
        <rect x="0" y="0" width={svgSize} height={svgSize} fill={COLORS.background} rx="8" />

          {/* Grid lines */}
          {gridLines.map((points, i) => (
            <polygon
              key={i} points={points} fill="none"
              stroke={i === 3 ? COLORS.borderMedium : COLORS.gridLight}
              strokeWidth={i === 3 ? 1.5 : 1}
            />
          ))}

          {/* Axis lines */}
          {axisLines.map((line, i) => (
            <line key={i} x1={centerX} y1={centerY} x2={line.x2} y2={line.y2} stroke={COLORS.gridLight} strokeWidth="1" />
          ))}

          {/* Job requirements polygon (gray) */}
          <polygon points={jobRequirementsPolygon} fill={COLORS.jobPolygon} stroke={COLORS.borderMedium} strokeWidth="1.5" strokeDasharray="4,2" />

          {/* Vendor capabilities polygon (yellow) */}
          <polygon points={vendorPolygon} fill={COLORS.vendorPolygon} stroke={COLORS.accent} strokeWidth="2" />

          {/* Center dot */}
          <circle cx={centerX} cy={centerY} r="3" fill={COLORS.border} />

          {/* Icons */}
          {iconPositions.map((pos, i) => (
            <IconTooltip key={i} text={labels[i]} x={pos.x} y={pos.y} value={vendorCapabilities[i]} svgSize={svgSize}>
              <g transform={`translate(${pos.x - 12}, ${pos.y - 12})`}>
                <circle cx="12" cy="12" r="12" fill="none" stroke={COLORS.border} strokeWidth="1.5" />
                <circle cx="12" cy="12" r="9" fill="none" stroke={COLORS.accent} strokeWidth="1" />
                <circle cx="12" cy="12" r="7" fill={COLORS.backgroundLight} stroke={COLORS.border} strokeWidth="0.5" />
                <svg x="5" y="5" width="14" height="14" viewBox="0 0 24 24" fill={COLORS.border}>
                  {Icons[iconKeys[i]]}
                </svg>
              </g>
            </IconTooltip>
          ))}
        </svg>

        {/* Match indicator - centered */}
        <div style={{
          marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px',
          padding: '4px 10px', backgroundColor: COLORS.backgroundLight,
          borderRadius: '4px', border: `1px solid ${COLORS.border}`,
        }}>
          <span style={{ fontSize: '10px', fontWeight: 600, color: COLORS.text }}>Score:</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: matchColor }}>{matchPercentage.toFixed(0)}%</span>
          <div style={{
            width: '50px', height: '5px', backgroundColor: COLORS.gridLight,
            borderRadius: '2px', overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.min(matchPercentage, 100)}%`, height: '100%',
              backgroundColor: matchColor, borderRadius: '2px',
            }} />
          </div>
        </div>
    </div>
  );
}

/**
 * Collapsible radar chart - Job-Centric only (7 factors)
 */
interface CollapsibleRadarChartProps {
  title: string;
  vendorCapabilities: number[];
  jobRequirements: number[];
  weights: number[];
  defaultExpanded?: boolean;
}

export function CollapsibleRadarChart({
  title, vendorCapabilities, jobRequirements, weights, defaultExpanded = false,
}: CollapsibleRadarChartProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div style={{ 
      marginTop: '10px', border: `2px solid ${COLORS.border}`,
      borderRadius: '6px', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '6px 10px', backgroundColor: COLORS.backgroundLight,
        borderBottom: expanded ? `1px solid ${COLORS.accent}` : 'none',
      }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.text, textTransform: 'uppercase' }}>
          {title}
        </span>
        <ToggleSwitch checked={expanded} onChange={setExpanded} label={expanded ? 'Hide' : 'Show'} />
      </div>

      {expanded && (
        <div style={{ padding: '10px', backgroundColor: COLORS.background, display: 'flex', justifyContent: 'center' }}>
          <RadarChart
            vendorCapabilities={vendorCapabilities}
            jobRequirements={jobRequirements}
            labels={factorLabels}
            weights={weights}
            size={170}
          />
        </div>
      )}
    </div>
  );
}

export { factorLabels };
