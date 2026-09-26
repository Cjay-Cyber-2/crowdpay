import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from 'i18next';
import ThankYouModal from '../../components/ThankYouModal';
import { OfflineBanner } from '../../components/OfflineBanner';

vi.mock('../../services/api', () => ({
  api: {
    sendBulkThankYou: vi.fn().mockResolvedValue({}),
    sendContributionThankYou: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../context/NetworkStatusContext', () => ({
  useNetworkStatus: () => ({ isOnline: false }),
}));

describe('ThankYouModal & OfflineBanner in French', () => {
  beforeEach(async () => {
    if (!i18n.isInitialized) {
      await i18n.init({ lng: 'en', resources: {} });
    }
    await i18n.changeLanguage('fr');
  });

  it('renders ThankYouModal in French without raw keys', () => {
    render(
      <ThankYouModal
        campaignId="camp-1"
        contribution={null}
        onClose={() => {}}
        onSent={() => {}}
      />
    );

    expect(screen.getByText('Envoyer un message de remerciement groupé')).toBeInTheDocument();
    expect(screen.getByText('Envoyer un message de remerciement à tous les contributeurs de cette campagne.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Écrivez votre message de remerciement ici...')).toBeInTheDocument();
    expect(screen.getByText('Envoyer le message')).toBeInTheDocument();
  });

  it('renders OfflineBanner in French without raw keys', () => {
    render(<OfflineBanner />);

    const banner = screen.getByRole('alert');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).not.toContain('offline.banner');
    expect(banner.textContent).toContain('Vous êtes actuellement hors ligne');
  });
});
