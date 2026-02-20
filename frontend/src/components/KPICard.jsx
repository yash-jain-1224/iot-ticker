import { Link } from 'react-router-dom';
import InfoTooltip from './InfoTooltip';

export default function KPICard({ 
  title, 
  value, 
  unit = '', 
  change, 
  changeType, // 'positive', 'negative', 'neutral'
  trend = 'neutral', // legacy support
  icon: Icon,
  iconBg = 'bg-blue-100',
  iconColor = 'text-blue-600',
  color = 'blue', // legacy support
  linkText,
  linkColor = 'text-blue-600',
  linkTo = '#',
  tooltipData
}) {
  // Legacy color mapping
  const colorClasses = {
    blue: { bg: 'bg-blue-50', text: 'text-blue-600' },
    green: { bg: 'bg-green-50', text: 'text-green-600' },
    orange: { bg: 'bg-orange-50', text: 'orange-600' },
    purple: { bg: 'bg-purple-50', text: 'text-purple-600' },
    red: { bg: 'bg-red-50', text: 'text-red-600' }
  };

  // Use new iconBg/iconColor or fall back to legacy color
  const bgClass = iconBg || colorClasses[color]?.bg || 'bg-blue-100';
  const textClass = iconColor || colorClasses[color]?.text || 'text-blue-600';

  // Determine change styling
  const getChangeStyle = () => {
    if (changeType === 'negative' || trend === 'down') {
      return {
        color: 'text-red-500',
        icon: (
          <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
          </svg>
        )
      };
    }
    if (changeType === 'positive' || trend === 'up') {
      return {
        color: 'text-green-500',
        icon: (
          <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        )
      };
    }
    return {
      color: 'text-gray-500',
      icon: (
        <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
        </svg>
      )
    };
  };

  const changeStyle = getChangeStyle();

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-1.5">
          <h3 className="text-base font-normal text-gray-600">{title}</h3>
          {tooltipData && (
            <InfoTooltip 
              title={tooltipData.title}
              description={tooltipData.description}
              calculation={tooltipData.calculation}
              significance={tooltipData.significance}
            />
          )}
        </div>
        <div className={`p-2.5 rounded-lg ${bgClass}`}>
          {Icon && <Icon className={`w-6 h-6 ${textClass}`} />}
        </div>
      </div>
      
      <div className="mb-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-4xl font-bold text-gray-900 leading-none">{value}</span>
          {unit && <span className="text-lg text-gray-500 font-normal">{unit}</span>}
        </div>
      </div>

      <div className="h-5 mb-3">
        {change && (
          <div className="flex items-center gap-1">
            {changeStyle.icon}
            <span className={`text-sm font-normal ${changeStyle.color}`}>
              {change}
            </span>
          </div>
        )}
      </div>

      {linkText && (
        <div className="border-t border-gray-200 pt-3">
          <Link to={linkTo} className={`inline-flex items-center gap-1 text-sm font-semibold ${linkColor} hover:underline`}>
            {linkText}
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      )}
    </div>
  );
}
