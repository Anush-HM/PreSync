import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// Shows where the app navigated to, plus any router state, so tests can
// assert on redirects without rendering the destination page.
export function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location" data-state={JSON.stringify(location.state ?? null)}>
      {location.pathname}
    </div>
  );
}

export function renderAt(initialEntry, routes) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        {routes}
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}
