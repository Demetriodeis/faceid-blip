// Configuração pública do front (nada secreto aqui).
window.FACEID_CONFIG = {
  // Número do WhatsApp do BOT (só dígitos, com DDI, ex.: '5511999998888').
  // Alimenta o botão "Voltar ao WhatsApp", que abre a conversa com o bot e é o
  // jeito mais confiável de sair do navegador interno. Vazio = botão escondido.
  supportWhatsapp: 'https//wa.me/553133496299',
  // Após a confirmação, tenta fechar a janela sozinho depois deste tempo (ms).
  // 0 desliga. Nem todo navegador permite fechar por script.
  autoCloseMs: 3000,
  // Quanto tempo o rosto precisa ficar parado e centralizado antes da captura.
  holdMsIdentify: 2000,
  holdMsEnroll: 1200,
};
