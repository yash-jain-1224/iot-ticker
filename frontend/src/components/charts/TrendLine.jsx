import PropTypes from 'prop-types'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

const TrendLine = ({ labels, datasets, options, height = 260, className = '' }) => {
  const inlineStyle = typeof height === 'number' ? { height } : { height: String(height) }

  const mergedOptions = {
    plugins: {
      legend: { labels: { boxWidth: 12, boxHeight: 12 } },
    },
    maintainAspectRatio: false,
    ...options,
  }

  const data = { labels, datasets }

  return (
    <div className={className} style={inlineStyle}>
      <Line data={data} options={mergedOptions} redraw />
    </div>
  )
}

TrendLine.propTypes = {
  labels: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.string, PropTypes.number])).isRequired,
  datasets: PropTypes.arrayOf(PropTypes.object).isRequired,
  options: PropTypes.object,
  height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  className: PropTypes.string,
}

TrendLine.defaultProps = {
  options: {},
  height: 260,
  className: '',
}

export default TrendLine
