// Configuração pública do front (nada secreto aqui).
window.FACEID_CONFIG = {
  // Número do WhatsApp do BOT (só dígitos, com DDI, ex.: '5511999998888').
  // Alimenta o botão "Voltar ao WhatsApp", que abre a conversa com o bot e é o
  // jeito mais confiável de sair do navegador interno. Vazio = botão escondido.
  supportWhatsapp: '553133496299',
  // Após a confirmação, tenta fechar a janela sozinho depois deste tempo (ms).
  // 0 desliga. Nem todo navegador permite fechar por script.
  autoCloseMs: 3000,
  // Quanto tempo o rosto precisa ficar parado e centralizado antes da captura.
  holdMsIdentify: 2000,
  holdMsEnroll: 1200,
  // Qualidade mínima da imagem do rosto (abra o site com &debug=1 e veja o
  // console para calibrar com a câmera dos seus usuários).
  //  minLuma/maxLuma: brilho médio do rosto (0-255) · minContrast: contraste
  //  minSharp: nitidez (borrão/movimento) · minScore: confiança do detector (0-1)
  quality: { minScore: 0.7, minLuma: 70, maxLuma: 205, minContrast: 28, minSharp: 30 },
};
