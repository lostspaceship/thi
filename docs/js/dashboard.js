async function init() {
    try {
        const response = await fetch('data/stations.json');
        const stations = await response.json();
        const select = document.getElementById('station-select');

        stations.forEach(station => {
            const option = document.createElement('option');
            option.value = station.file;
            option.textContent = station.name;
            if (station.name === "Leeuwarden") option.selected = true;  // Set Leeuwarden as the default selected station
            select.appendChild(option);
        });

        // Load default station
        loadStation('leeuwarden.json');
    } catch (e) {
        console.error('[init] Error initializing stations:', e);
    }
}

async function loadStation(filename) {
    try {
        const response = await fetch(`data/${filename}`);
        const data = await response.json();
        updateUI(data);
    } catch (e) {
        console.error('[loadStation] Error loading station data:', e);
    }
}

function updateUI(data) {
    // Update status box
    const maxTHI = Math.max(...data.forecast.map(f => f.THI_In));
    const statusBox = document.getElementById('status-box');

    if (maxTHI < 68) {
        statusBox.className = 'status-box status-green';
        statusBox.textContent = 'Geen stress';
    } else if (maxTHI < 72) {
        statusBox.className = 'status-box status-orange';
        statusBox.textContent = 'Stress in aantocht';
    } else {
        statusBox.className = 'status-box status-red';
        statusBox.textContent = 'Stress!';
    }

    // Update Chart
    renderChart(data.forecast);

    // Update Table
    const tbody = document.querySelector('#forecast-table tbody');
    tbody.innerHTML = '';
    data.forecast.forEach(f => {
        const tr = document.createElement('tr');
        if (f.Advies && f.Advies !== 'Geen alert') {
            tr.classList.add('row-alert');
        }
        tr.innerHTML = `
            <td>${f.Tijd}</td>
            <td>${f.Temp_Out}</td>
            <td>${f.RH}</td>
            <td>${f.THI_Out}</td>
            <td>${f.THI_In}</td>
            <td>${f.Advies}</td>
        `;
        tbody.appendChild(tr);
    });

    // Update Buienradar
    const iframe = document.getElementById('buienradar-iframe');
    iframe.src = `https://gadgets.buienradar.nl/gadget/zoommap/?lat=${data.lat}&lng=${data.lon}&overname=2&zoom=8&naam=${data.station}&size=3&voor=0`;

    // Update Footer
    document.getElementById('last-updated').textContent = `Laatst bijgewerkt: ${data.updated_at}`;
}

const mobileQuery = window.matchMedia('(max-width: 768px)');
let lastForecast = null;

function buildChartFigure(forecast, { isMobile, big }) {
    const times = forecast.map(f => f.Tijd);
    const thiIn = forecast.map(f => f.THI_In);
    const thiOut = forecast.map(f => f.THI_Out);

    const traceIn = {
        x: times,
        y: thiIn,
        name: 'THI Binnen',
        mode: isMobile && !big ? 'lines' : 'lines+markers',
        line: { color: 'black', width: isMobile && !big ? 2.5 : 2 }
    };

    const traceOut = {
        x: times,
        y: thiOut,
        name: 'THI Buiten',
        mode: 'lines',
        line: { color: 'blue', dash: 'dash' }
    };

    const layout = {
        yaxis: { range: [30, 85] },
        xaxis: {
            type: 'category',
            tickangle: -90,
            tickfont: { size: isMobile ? 9 : 11 },
            automargin: true,
        },
        hovermode: 'x unified',
        legend: isMobile && !big
            ? { orientation: 'h', y: 1.15, x: 0.5, xanchor: 'center', font: { size: 11 } }
            : { orientation: 'h', y: -0.2, x: 0.5, xanchor: 'center', font: { size: 12 } },
        margin: isMobile && !big ? { t: 40, b: 45, l: 40, r: 40 } : { t: 20, b: 45, l: 55, r: 55 },
        annotations: [{
            text: 'THI',
            xref: 'paper',
            yref: 'paper',
            x: 0,
            y: 1,
            xanchor: 'left',
            yanchor: 'bottom',
            showarrow: false,
            font: { size: isMobile ? 11 : 12, color: '#666' },
        }],
        shapes: [
            { type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0, y1: 68, fillcolor: 'lightgreen', opacity: 0.2, line: {width: 0}, layer: 'below' },
            { type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 68, y1: 72, fillcolor: 'yellow', opacity: 0.2, line: {width: 0}, layer: 'below' },
            { type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 72, y1: 78, fillcolor: 'orange', opacity: 0.2, line: {width: 0}, layer: 'below' },
            { type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 78, y1: 82, fillcolor: 'red', opacity: 0.2, line: {width: 0}, layer: 'below' },
            { type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 82, y1: 100, fillcolor: 'darkred', opacity: 0.2, line: {width: 0}, layer: 'below' }
        ],
        height: big
            ? Math.round(isMobile
                ? Math.min(window.innerHeight * 0.6, window.innerWidth * 1.3, 520)
                : Math.min(window.innerHeight * 0.75, 750))
            : (isMobile ? 380 : 900),
    };

    const config = {
        staticPlot: true,
        responsive: true,
        format: 'svg'
    };

    return { data: [traceIn, traceOut], layout, config };
}

function renderChart(forecast) {
    lastForecast = forecast;
    const isMobile = mobileQuery.matches;
    const figure = buildChartFigure(forecast, { isMobile, big: false });
    Plotly.newPlot('thi-chart', figure.data, figure.layout, figure.config);
}

// Re-render with mobile/desktop layout when crossing the breakpoint
// (e.g. orientation change), not on every pixel of a resize.
mobileQuery.addEventListener('change', () => {
    if (lastForecast) renderChart(lastForecast);
});

// Click-to-enlarge: re-render the same data bigger inside a modal.
const chartContainer = document.getElementById('chart-container');
const chartModal = document.getElementById('chart-modal');

function openChartModal() {
    if (!lastForecast) return;
    chartModal.classList.add('is-open');
    chartModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    const figure = buildChartFigure(lastForecast, { isMobile: mobileQuery.matches, big: true });
    Plotly.newPlot('thi-chart-large', figure.data, figure.layout, figure.config);
}

function closeChartModal() {
    chartModal.classList.remove('is-open');
    chartModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

if (chartContainer && chartModal) {
    chartContainer.addEventListener('click', openChartModal);
    chartContainer.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openChartModal();
        }
    });
    document.getElementById('chart-modal-close').addEventListener('click', closeChartModal);
    document.getElementById('chart-modal-backdrop').addEventListener('click', closeChartModal);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && chartModal.classList.contains('is-open')) {
            closeChartModal();
        }
    });
}

init();
