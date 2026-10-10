import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BlockRenderer } from '@emdash-cms/blocks';
import { ordersView } from '../../src/features/orders/admin/view.ts';
import { paid, zero } from './fixtures.mjs';
import './style.css';
function App() {
 const [mode, setMode] = useState('examples'); const [selected, select] = useState(); const view = useRef(null);
 useEffect(() => { view.current?.focus(); }, [mode, selected]);
 const input = mode === 'unavailable' ? { status: 'unavailable' } : { status: 'available', orders: mode === 'empty' ? [] : [paid, zero] };
 return <main><header><p>COMMERCE / INSPECTION</p><h1>Orders preview</h1><p>All records are synthetic. Read-only isolated preview — not an installed admin page.</p></header><nav aria-label="Preview scenarios">{['examples', 'empty', 'unavailable'].map(value => <button key={value} aria-pressed={mode === value} onClick={() => { setMode(value); select(undefined); }}>{value === 'examples' ? 'Synthetic orders' : value === 'empty' ? 'Empty' : 'Unavailable'}</button>)}</nav><section ref={view} tabIndex={-1} aria-label="Order inspection"><BlockRenderer blocks={ordersView(input, selected).blocks} onAction={action => { if (action.action_id === 'orders.list') select(undefined); else if (action.action_id?.startsWith('orders.open:')) select(decodeURIComponent(action.action_id.slice(12))); }} /></section><footer>Fulfillment is not recorded. Payment does not establish shipment. No live services connected.</footer></main>;
}
createRoot(document.getElementById('root')).render(<App />);
