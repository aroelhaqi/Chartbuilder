/*
 * ### ChartGridBars
 * Render a grid of N columns by N rows of bar (row) charts
*/

import React, {PropTypes} from 'react';
import update from 'react-addons-update';

import {bind,clone,each,map,max,maxBy,reduce} from 'lodash';

const SessionStore    = require("../../stores/SessionStore");
const separators      = SessionStore.get("separators");
const d3 = require("d3");
const formatThousands = d3.format(separators.thousands);

/* Helper functions */
const help = require("../../util/helper.js");

/* Renderer mixins */
const ChartRendererMixin = require("../mixins/ChartRendererMixin.js");

const HorizontalGridLines = require("../shared/HorizontalGridLines.jsx");
const VerticalGridLines   = require("../shared/VerticalGridLines.jsx");
const BarGroup            = require("../series/BarGroup.jsx");
const SvgWrapper          = require("../svg/SvgWrapper.jsx");
const scaleUtils          = require("../../util/scale-utils.js");
const seriesUtils         = require("../../util/series-utils.js");
const gridUtils           = require("../../util/grid-utils.js");
const Chart               = require("../shared/Chart.jsx");
const VerticalAxis        = require("../shared/VerticalAxis.jsx");
const BarLabels           = require("../shared/BarLabels.jsx");
const BlockerRects        = require("../shared/BlockerRects.jsx");
const SeriesLabel         = require("../shared/SeriesLabel.jsx");

/**
 * ### Component that renders bar (row) charts in a chart grid
 * @property {boolean} editable - Allow the rendered component to interacted with and edited
 * @property {object} displayConfig - Parsed visual display configuration for chart grid
 * @property {object} chartProps - Properties used to draw this chart
 * @instance
 * @memberof ChartGridRenderer
 */
const ChartGridBars = React.createClass({

	propTypes: {
		editable: PropTypes.bool.isRequired,
		displayConfig: PropTypes.shape({
			margin: PropTypes.obj,
			padding: PropTypes.obj
		}).isRequired,
		chartProps: PropTypes.shape({
			chartSettings: PropTypes.array.isRequired,
			data: PropTypes.array.isRequired,
			scale: PropTypes.object.isRequired,
			_grid: PropTypes.object.isRequired
		}).isRequired
	},

	mixins: [ ChartRendererMixin ],

	getInitialState: function() {
		return {
			maxTickWidth: 0,
			barLabelOverlap: 0 // how far a bar label is overlapping the available chart width
		};
	},

	// render a single bar in the grid. this gets passed to `gridUtils.makeMults` to
	// render one for each column of data
	// TODO: have in mind a maybe better way to do this
	_barGridBlock: function(d, i) {
		const props = this.props;

		const barProps = {
			key: "bar",
			bars: [{
				data: d.values,
				colorIndex: props.chartProps.chartSettings[i].colorIndex
			}],
			orientation: "horizontal"
		};

		const bar = seriesUtils.createSeries("column", barProps);

		return [
			<SeriesLabel
				key="label"
				xVal={0}
				colorIndex={props.chartProps.chartSettings[i].colorIndex}
				text={props.chartProps.chartSettings[i].label}
			/>,
			bar,
			<BlockerRects
				key="blockers"
				seriesNumber={i}
				data={d.values}
			/>,
			<BarLabels
				key="barlabels"
				data={d.values}
				prefix={props.chartProps.scale.primaryScale.prefix}
				suffix={props.chartProps.scale.primaryScale.suffix}
			/>,
			<VerticalGridLines
				key="vert"
				tickValues={[0]}
				className="zero"
			/>
		];
	},

	render: function() {
		const props = this.props;
		const displayConfig = props.displayConfig;
		const margin = displayConfig.margin;
		const styleConfig = props.styleConfig;
		const chartProps = props.chartProps;
		const dimensions = props.dimensions;
		const primaryScale = chartProps.scale.primaryScale;
		const tickFont = styleConfig.fontSizes.medium + "px " + styleConfig.fontFamilies.axes;
		const tickTextHeight = help.computeTextWidth("M", tickFont);

		/* Get the text values used for the labels */
		const tickLabels = map(chartProps.data[0].values, function(d) {
			return d.entry;
		});

		const widthPerTick = map(tickLabels, function(t) {
			return help.computeTextWidth(t, tickFont);
		});

		const tickWidths = {
			widths: widthPerTick,
			max: max(widthPerTick)
		};

		const chartAreaDimensions = {
			width: (
				dimensions.width - margin.left - margin.right -
				displayConfig.padding.left - displayConfig.padding.right -
				tickWidths.max
			),
			height: (
				dimensions.height +
			(displayConfig.afterLegend * chartProps._grid.rows)
			)
		};

		const outerDimensions = {
			width: dimensions.width,
			height: dimensions.height +
			(displayConfig.margin.top + displayConfig.margin.bottom) +
			displayConfig.padding.bottom +
			(displayConfig.afterLegend * chartProps._grid.rows)
		}

		// range for all charts in grid (outer)
		const xRangeOuter = [props.styleConfig.xOverTick, chartAreaDimensions.width - props.styleConfig.xOverTick];
		const yRangeOuter = [chartAreaDimensions.height, 0];

		// place grid elements using gridScales generated by d3
		const gridScales = gridUtils.createGridScales(chartProps._grid, {
			x: xRangeOuter,
			y: yRangeOuter
		}, {
			xInnerPadding: props.displayConfig.gridPadding.xInnerPadding,
			xOuterPadding: props.displayConfig.gridPadding.xOuterPadding,
			yInnerPadding: props.displayConfig.gridPadding.yInnerPadding,
			yOuterPadding: props.displayConfig.gridPadding.yOuterPadding
		});

		// Create temporary x axis to figure out where the furthest bar label is, so
		// that we can offset it
		const _tmpXAxis = scaleUtils.generateScale("linear", primaryScale, chartProps.data, [0, gridScales.cols.rangeBand()]);

		// TODO: this is ugly
		const barLabels = { widths: [], xVals: []};
		each(chartProps.data, function(series, i) {
			barLabels.widths[i] = [];
			each(series.values, function(val, ix) {
				const renderPrefSuf = (ix === 0);
				const formatted = help.addPrefSuf(val.value, renderPrefSuf, primaryScale.prefix, primaryScale.suffix);
				const txtWidth = help.computeTextWidth(formatted, tickFont);
				barLabels.widths[i].push(txtWidth);
				barLabels.xVals.push(txtWidth + _tmpXAxis.scale(val.value) + props.displayConfig.blockerRectOffset);
			});
		});

		const barLabelsMaxX = max(barLabels.xVals);
		const barLabelOverlap = Math.max(0, barLabelsMaxX - gridScales.cols.rangeBand());

		// range and axes for each individual small chart in the grid (inner)
		const xRangeInner = [0, gridScales.cols.rangeBand() - barLabelOverlap];
		const yRangeInner = [displayConfig.afterLegend, gridScales.rows.rangeBand() - displayConfig.afterLegend];
		const xAxis = scaleUtils.generateScale("linear", primaryScale, chartProps.data, xRangeInner);
		const yAxis = scaleUtils.generateScale("ordinal", primaryScale, chartProps.data, yRangeInner, {
			inner: displayConfig.barInnerPadding,
			outer: displayConfig.barOuterPadding
		});

		// `Outer` is the common wrapper component that will be used for each chart
		// in the grid
		const Outer = React.createFactory(Chart);
		const outerProps = {
			chartType: "bar",
			styleConfig: props.styleConfig,
			displayConfig: displayConfig,
			editable: props.editable,
			xScale: xAxis.scale,
			yScale: yAxis.scale,
			tickTextHeight: tickTextHeight,
			tickFont: tickFont,
			labelWidths: barLabels.widths,
			tickWidths: tickWidths
		};

		const grid = gridUtils.makeMults(Outer, outerProps, chartProps.data, gridScales, this._barGridBlock);

		// create vertical axis and grid lines for each row.
		// this should possibly be part of the grid generation
		// and could be its own wrapper component
		const verticalAxes = map(gridScales.rows.domain(), function(row, i) {
			const yPos = gridScales.rows(i);
			return (
				<g
					className="axis grid-row-axis"
					key={"grid-row-" + i}
					transform={ "translate(" + [0, yPos] + ")" }
				>
					<HorizontalGridLines
						tickValues={yAxis.tickValues}
						yScale={yAxis.scale}
						x2={dimensions.width - margin.right - margin.left}
						styleConfig={props.styleConfig}
						displayConfig={displayConfig}
						translate={[0, 0]}
						tickValues={tickLabels}
					/>
					<VerticalAxis
						tickValues={tickLabels}
						tickWidths={tickWidths}
						dimensions={chartAreaDimensions}
						styleConfig={props.styleConfig}
						displayConfig={displayConfig}
						xScale={xAxis.scale}
						yScale={yAxis.scale}
						tickTextHeight={tickTextHeight}
						tickFont={tickFont}
						textAlign="inside"
					/>
				</g>
			)
		});

		return (
			<SvgWrapper
				outerDimensions={outerDimensions}
				metadata={props.metadata}
				displayConfig={displayConfig}
				styleConfig={props.styleConfig}
			>
			<g
				className="grid-wrapper"
				transform={ "translate(" + [0, props.displayConfig.padding.top] + ")" }
			>
				{verticalAxes}
				<g
					className="grid-charts"
					transform={ "translate(" + [tickWidths.max, 0] + ")" }
				>
					{grid}
				</g>
			</g>
			</SvgWrapper>
		);
	}
});

module.exports = ChartGridBars;

function format_bar_labels(label) {
	if (label === null) {
		return "no data";
	} else {
		return formatThousands(label);
	}
}

