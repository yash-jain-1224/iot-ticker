import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { useState, useRef, useEffect } from 'react';

export default function InfoTooltip({ title, description, calculation, significance, className = '' }) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState('left');
  const buttonRef = useRef(null);
  const tooltipRef = useRef(null);

  useEffect(() => {
    if (isVisible && buttonRef.current && tooltipRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const tooltipWidth = 320; // w-80 = 320px
      const viewportWidth = window.innerWidth;
      const spaceOnRight = viewportWidth - buttonRect.right;
      
      // If there's not enough space on the right (less than tooltip width + padding)
      if (spaceOnRight < tooltipWidth + 20) {
        setPosition('right');
      } else {
        setPosition('left');
      }
    }
  }, [isVisible]);

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        ref={buttonRef}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onClick={() => setIsVisible(!isVisible)}
        className="text-gray-400 hover:text-gray-600 transition-colors focus:outline-none"
        type="button"
        aria-label={`Information about ${title}`}
      >
        <InformationCircleIcon className="w-4 h-4" />
      </button>
      
      {isVisible && (
        <div 
          ref={tooltipRef}
          className={`absolute z-50 top-full mt-2 w-80 ${position === 'right' ? 'right-0' : 'left-0'}`}
        >
          <div className="bg-gray-900 text-white text-sm rounded-lg shadow-xl overflow-hidden">
            <div className="bg-gray-800 px-4 py-3 border-b border-gray-700">
              <h4 className="font-semibold text-white">{title}</h4>
            </div>
            <div className="px-4 py-3 space-y-3">
              {description && (
                <div>
                  <p className="text-gray-300">{description}</p>
                </div>
              )}
              {calculation && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Calculation</p>
                  <p className="text-gray-300">{calculation}</p>
                </div>
              )}
              {significance && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Significance</p>
                  <p className="text-gray-300">{significance}</p>
                </div>
              )}
            </div>
            <div className={`absolute -top-2 ${position === 'right' ? 'right-4' : 'left-4'}`}>
              <div className="border-8 border-transparent border-b-gray-900"></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
