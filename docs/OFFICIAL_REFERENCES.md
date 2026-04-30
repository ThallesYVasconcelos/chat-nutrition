# Referencias oficiais para ingestao RAG

Use esta lista como backlog inicial de documentos para colocar em `data/reference_docs` e embedar com `scripts/ingest_documents.py`.

## Alimentacao saudavel e planos alimentares

- Ministerio da Saude - Guia Alimentar para a Populacao Brasileira: https://www.gov.br/saude/pt-br/assuntos/saude-brasil/publicacoes-para-promocao-a-saude/guia_alimentar_populacao_brasileira_2ed.pdf/view
- Ministerio da Saude - Guias Alimentares: https://www.gov.br/saude/pt-br/composicao/saps/promocao-da-saude/guias-alimentares
- Ministerio da Saude - Guia Alimentar para Criancas Brasileiras Menores de 2 Anos: https://www.gov.br/saude/pt-br/composicao/saps/promocao-da-saude/guias-alimentares/publicacoes/guia_da_crianca_2019.pdf/view
- WHO - Healthy diet: https://www.who.int/en/news-room/fact-sheets/detail/healthy-diet

## Antropometria, consumo e dados de alimentos

- Ministerio da Saude - Protocolos do SISVAN: https://www.gov.br/saude/pt-br/composicao/saps/vigilancia-alimentar-e-nutricional/arquivos/protocolos-do-sistema-de-vigilancia-alimentar-e-nutricional-sisvan/view
- IBGE - Tabelas de composicao nutricional dos alimentos consumidos no Brasil: https://www.ibge.gov.br/estatisticas/economicas/precos-e-custos/9050-pesquisa-de-orcamentos-familiares.html?edicao=9063
- NEPA/UNICAMP - Tabela Brasileira de Composicao de Alimentos (TACO): https://nepa.unicamp.br/categoria/taco/

## Patologias e condicoes que pedem revisao profissional

- Ministerio da Saude - Linha de cuidado da obesidade no adulto: https://linhasdecuidado.saude.gov.br/portal/obesidade-no-adulto/
- Ministerio da Saude/CONITEC - PCDT Diabete Melito Tipo 2: https://www.gov.br/conitec/pt-br/midias/protocolos/PCDTDM2.pdf/view
- Ministerio da Saude/CONITEC - PCDT Diabete Melito Tipo 1: https://www.gov.br/conitec/pt-br/midias/relatorios/2019/relatrio_pcdt-diabetes-mellitus-tipo-1_2019.pdf/view
- Ministerio da Saude/CONITEC - PCDT Hipertensao Arterial Sistemica: https://www.gov.br/conitec/pt-br/midias/protocolos/pcdt-hipertensao-arterial-sistemica.pdf/view
- Ministerio da Saude/CONITEC - PCDT Doenca Celiaca: https://www.gov.br/conitec/pt-br/midias/protocolos/pcdt_doencaceliaca.pdf/view
- KDIGO - 2024 CKD Guideline: https://kdigo.org/guidelines/ckd-evaluation-and-management/

## Observacao clinica

O chatbot deve tratar estes documentos como apoio educacional e de triagem. Condutas para patologias, gestacao, lactacao, criancas, idosos frageis, transtornos alimentares, alergias graves, doenca renal, diabetes com insulina, pos-bariatrica e oncologia devem acionar `requires_professional_review`.

