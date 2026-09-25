/*
  MODELO PARA REVISÃO E EXECUÇÃO MANUAL PELO DBA.
  NÃO É EXECUTADO AUTOMATICAMENTE PELO CRM.
  Ajuste a senha de acordo com a política da empresa.
*/
USE [master];
GO
CREATE LOGIN [crm_leitura] WITH PASSWORD = 'SUBSTITUA_POR_SENHA_FORTE_E_UNICA', CHECK_POLICY = ON;
GO
USE [MASERP];
GO
CREATE USER [crm_leitura] FOR LOGIN [crm_leitura];
ALTER ROLE [db_datareader] ADD MEMBER [crm_leitura];
DENY INSERT, UPDATE, DELETE, EXECUTE, ALTER, CONTROL TO [crm_leitura];
GO
