# Finance tracker templates — Notion structures, as read

Raw outlines behind `docs/finance-tracker.md`, read 2026-09-10 through Notion's
page-chunk API from the public previews. Property ids Notion does not name
(system properties) appear as short codes.

## Finance Tracker by Chris (Sentele)

`broad-snowman.notion.site/Finance-Tracker-1705eed88b208136b3acee5f34d3d0b6`

```
=== OUTLINE
[page] Finance Tracker
    ### Thanks for checking out our template!
    [toggle] Here’s a 2-minute guide to set up this template 📃
    ### Searching for a template to manage all aspects of finance? 
    [toggle] Check out Finance Manager, which includes Monthly Reports, Investment Tracker, Debt Tracker, Saving Goals, & much more (available in all currencies!) 
  [columns]
    [column 0.21]
      [image] Sub Heading.png
      [button] 
      [button] 
      [button] 
      [image] Sub Heading (1).png
      [DATABASE] '' cid=None (inline)
          * 'This Month' [gallery] shows=['title', 'tr>_', 'RbEk', '`=Xq'] gallery_cover_size="small"
          * 'Last Month' [gallery] shows=['title', '|`o<', 'RbEk', 'da{S'] gallery_cover_size="small"
      [page] Database
        [columns]
          [column 0.81]
            [DATABASE] 'Accounts' cid=1705eed8 (inline)
                - Balance Text: formula  = {}
                - Total income: rollup  sum of Incomes→FWBB (number)
                - TransferToAccount: relation  → Transfers (back: To Account)
                - Expenses: relation  → Expenses (back: Account)
                - Balance: formula  = {}
                - TransferOut: relation  → Transfers (back: From Account)
                - Initial Amount: number  (dollar)
                - Total Expenses: rollup  sum of Expenses→;lrg (number)
                - Total TransferIn: rollup  sum of TransferToAccount→Tfj_ (number)
                - Total TransferOut: rollup  sum of TransferOut→Tfj_ (number)
                - Incomes: relation  → Incomes (back: Accounts)
                - Account: title
                * None [table] shows=['Account', 'Initial Amount', 'Balance', 'Total TransferIn', 'Total TransferOut', 'Total Expenses', 'Total income', 'Expenses', 'Incomes', 'TransferOut', 'TransferToAccount', 'Balance Text'] gallery_cover_size="small"
            [DATABASE] 'Categories' cid=1705eed8 (inline)
                - Expenses: relation  → Expenses (back: Category)
                - Monthly Budget: number  (dollar)
                - Usage: formula  = {}
                - Usage Last Month: formula  = {}
                - Expense This Month: rollup  sum of Expenses→z{`\ (formula)
                - Expense Last Month: formula  = {}
                - Category: title
                * None [table] shows=['Category', 'Monthly Budget', 'Expenses', 'Expense This Month', 'Expense Last Month', 'Usage', 'Usage Last Month']
            [DATABASE] 'Expenses' cid=1705eed8 (inline)
                - Amount: number  (dollar)
                - Account: relation  → Accounts (back: Expenses)
                - Date: date
                - Category: relation  → Categories (back: Expenses)
                - Expense This Month: formula  = {}
                - Expense: title
                * None [table] shows=['Expense', 'Amount', 'Date', 'Account', 'Category', '`DJe', 'Expense This Month']
            [DATABASE] 'Incomes' cid=1705eed8 (inline)
                - Amount: number  (dollar)
                - Source: select  [Salary, Ecommerce, Affiliates, Digital Products, Real Estate]
                - Date: date
                - Accounts: relation  → Accounts (back: Incomes)
                - Income: title
                * None [table] sort=Date ascending shows=['Income', 'Amount', 'Date', 'Accounts', 'JOFs']
            [DATABASE] 'Transfers' cid=1705eed8 (inline)
                - Date: date
                - To Account: relation  → Accounts (back: TransferToAccount)
                - Amount: number  (dollar)
                - From Account: relation  → Accounts (back: TransferOut)
                - Transactions: title
                * None [table] shows=['Transactions', 'Date', 'Amount', 'From Account', 'To Account', 'R{fY']
    [column 0.54]
      [image] Main Heading (3).png
      [DATABASE] '' cid=None (inline)
          * 'Recent' [table] sort=U}~? descending shows=['title', ';lrg', '>}ZW', 'U}~?']
          * 'Weekly' [list] sort=U}~? descending shows=['title', 'pG`I', ';lrg', 'U}~?']
          * 'Monthly' [list] sort=U}~? descending shows=['title', ';lrg', 'pG`I', 'U}~?']
          * 'Chart' [chart] sort=U}~? descending chart_config={"type": "column", "dataConfig": {"type": "groups_reducer", "groupBy": {"sort": {"type": "ascending"}, "type": "date", "groupBy": "month", "property": "U}~?"}, "aggregationConfig": {"aggregation": {"property": ";lrg", "aggregator": "sum"}, "seriesFormat": {"displayType": "column"}, "stackOptions": {"groupBy": {"sort": {"type": "ascending"}, "type": "relation", "property": "pG`I"}}}}, "chartFormat": {"mainSort": "x-ascending", "hideLegend": false, "axisGroupStyle": "normal"}}
      [image] Main Heading (4).png
      [DATABASE] '' cid=None (inline)
          * 'Recent' [table] sort=dVsY descending shows=['title', 'FWBB', 't;JY', 'dVsY']
          * 'Monthly' [list] sort=dVsY descending shows=['title', 't;JY', 'FWBB', 'dVsY']
          * 'Yearly' [list] sort=dVsY descending shows=['title', 'FWBB', 't;JY', 'dVsY']
          * 'Chart' [chart] sort=dVsY descending chart_config={"type": "column", "dataConfig": {"type": "groups_reducer", "groupBy": {"sort": {"type": "ascending"}, "type": "date", "groupBy": "month", "property": "dVsY", "hideEmptyGroups": false}, "aggregationConfig": {"aggregation": {"property": "FWBB", "aggregator": "sum"}, "seriesFormat": {"displayType": "column"}, "stackOptions": {"groupBy": {"sort": {"type": "ascending"}, "type": "select", "property": "O<rF"}}}}, "chartFormat": {"mainSort": "x-ascending", "hideLegend": false, "axisGroupStyle": "normal", "axisHideEmptyGroups": false}}
      [image] Main Heading (5).png
      [DATABASE] '' cid=None (inline)
          * 'Recent Transfers' [list] sort=<UbU descending shows=['title', '\\\\lm', 'HtF:', 'Tfj_']
          * 'Monthly' [list] sort=<UbU descending shows=['title', 'Tfj_', '\\\\lm', 'HtF:']
    [column 0.25]
      [image] Sub Heading.png
      [DATABASE] '' cid=None (inline)
          * 'Expenses' [chart] sort=title ascending chart_config={"type": "donut", "dataConfig": {"type": "groups_reducer", "groupBy": {"sort": {"type": "ascending"}, "type": "relation", "property": "pG`I", "hideEmptyGroups": true}, "aggregationConfig": {"aggregation": {"property": ";lrg", "aggregator": "sum"}}}, "chartFormat": {"height": "medium", "mainSort": "y-descending", "colorTheme": "blue", "hideLegend": true, "donutDataLabels": "name", "weightColorValue": false, "axisShowDataLabels": true}}
          * 'Income' [chart] chart_config={"type": "donut", "dataConfig": {"type": "groups_reducer", "groupBy": {"sort": {"type": "manual"}, "type": "select", "property": "O<rF", "hideEmptyGroups": true}, "aggregationConfig": {"aggregation": {"property": "FWBB", "aggregator": "sum"}}}, "chartFormat": {"mainSort": "y-descending", "donutDataLabels": "name_and_value", "axisHideEmptyGroups": false}}
      [toggle] Would you like to use this widget instead?
      [image] Sub Heading (2).png
      [DATABASE] '' cid=None (inline)
          * 'Accounts' [gallery] shows=['title', '<^~m'] gallery_cover_size="small"
  [text] Are you a startup or founder? Apply now to get 3 months free on the Notion Business plan with Notion AI
  [divider] 
  [columns]
    [column 0.06]
      [image] 
    [column 1.06]
      [text] Sentele
      [text] Website | YouTube | Support
      [text] © 2026 Sentele. All rights reserved.
```

### Formulas, rollups, automations

```
AUTOMATION {"id": "1705eed8-8b20-8184-8e8f-004d5429e481", "version": 3, "space_id": "e67734e7-b7a9-486d-9e86-f52c55a42809", "parent_table": "block", "parent_id": "1705eed8-8b20-8180-ae0d-eb6adc87b79d", "created_by_id": "8305a7b9-9e4a-4297-add4-b09ed4ef0ee1", "created_by_table": "notion_user", "created_time": 1735878955426, "last_edited_by_id": "8305a7b9-9e4a-4297-add4-b09ed4ef0ee1", "last_edited_b
AUTOMATION {"id": "1705eed8-8b20-8176-a48c-004d7b57bee1", "version": 3, "space_id": "e67734e7-b7a9-486d-9e86-f52c55a42809", "parent_table": "block", "parent_id": "1705eed8-8b20-8139-84be-fe19145274e7", "created_by_id": "8305a7b9-9e4a-4297-add4-b09ed4ef0ee1", "created_by_table": "notion_user", "created_time": 1735878955426, "last_edited_by_id": "8305a7b9-9e4a-4297-add4-b09ed4ef0ee1", "last_edited_b
AUTOMATION {"id": "1705eed8-8b20-81a9-9b57-004d968d6142", "version": 1, "space_id": "e67734e7-b7a9-486d-9e86-f52c55a42809", "parent_table": "block", "parent_id": "1705eed8-8b20-8166-9ec2-df6c68098e30", "created_by_id": "8305a7b9-9e4a-4297-add4-b09ed4ef0ee1", "created_by_table": "notion_user", "created_time": 1735878955426, "last_edited_by_id": "8305a7b9-9e4a-4297-add4-b09ed4ef0ee1", "last_edited_b
=== FORMULAS
Categories.Usage = round(prop(Expense This Month)/prop(Monthly Budget)*100)/100   [show_as {'type': 'ring', 'color': 'green', 'maxValue': 1, 'showValue': True}] [format percent]
Categories.Usage Last Month = round(prop(Expense Last Month)/prop(Monthly Budget)*100)/100   [show_as {'type': 'ring', 'color': 'green', 'maxValue': 1, 'showValue': True}] [format percent]
Categories.Expense This Month = sum(Expenses → Expense This Month)
Categories.Expense Last Month = prop(Expenses).filter(current.prop(Date).formatDate("MM-YY") == 
	today().dateSubtract(1, "months").formatDate("MM-YY")).map(current.prop(Amount)).sum()
Expenses.Expense This Month = if(formatDate(now(), "MMMM YYYY") == formatDate(prop(Date), "MMMM YYYY"), prop(Amount), 0) [format dollar]
Accounts.Balance Text = "Current Balance: ".style("b") + prop(Balance).formatNumber("usd") [format dollar]
Accounts.Total income = sum(Incomes → Amount)
Accounts.Balance = prop(Initial Amount)+prop(Total income)-prop(Total Expenses)+prop(Total TransferIn)-prop(Total TransferOut) [format dollar]
Accounts.Total Expenses = sum(Expenses → Amount)
Accounts.Total TransferIn = sum(TransferToAccount → Amount)
Accounts.Total TransferOut = sum(TransferOut → Amount)

```

## Personal Finance Tracker by Notion

`notion.notion.site/Personal-Finance-Tracker-901648e0ed924bde8a2b07989a1df039`

```
=== OUTLINE
[page] Personal Finance Tracker
  [DATABASE] '' cid=None (inline)
      * 'Finance Dashboard' [dashboard] dashboard_layout_pointer={"id": "31fefdee-ad05-80fe-aced-006e7aa05322", "table": "layout", "spaceId": "e12b42ac-4e54-476f-a4f5-7d6bdb1e61e2"}
  [DATABASE] 'Total Savings' cid=ee5645bf (inline)
      - Total Monthly Expenses: rollup  sum of Monthly Expenses→Oxi| (number)
      - Monthly Net (Formatted): formula  = {"args": [{"type": "constant", "value": "Net: $", "value_type": "string", "result_type": "text"}, {"args": [{"args": [{"id": "TYHj", "name": "Monthly Net", "type": "property", "result_type": "number"}], "name": "round", "type": "function", "result_type": "number"}], "name": "format", "type": "function", "result_type": "text"}], "name": "add", "type": "operator", "operator": "+", "result_type": "text"}
      - Monthly Expenses (Formatted): formula  = {"args": [{"type": "constant", "value": "Expenses: $", "value_type": "string", "result_type": "text"}, {"args": [{"args": [{"id": "CTBy", "name": "Total Monthly Expenses", "type": "property", "result_type": "number"}], "name": "round", "type": "function", "result_type": "number"}], "name": "format", "type": "function", "result_type": "text"}], "name": "add", "type": "operator", "operator": "+", "result_type": "text"}
      - Monthly Income: relation  → Income (back: Month)
      - Monthly Net: formula  = {"args": [{"id": "ibqY", "name": "Total Mothly Income", "type": "property", "result_type": "number"}, {"id": "CTBy", "name": "Total Monthly Expenses", "type": "property", "result_type": "number"}], "name": "subtract", "type": "operator", "operator": "-", "result_type": "number"}
      - Monthly Expenses: relation  → Expenses (back: Month)
      - Monthly Income (Formatted): formula  = {"args": [{"type": "constant", "value": "Income: $", "value_type": "string", "result_type": "text"}, {"args": [{"args": [{"id": "ibqY", "name": "Total Mothly Income", "type": "property", "result_type": "number"}], "name": "round", "type": "function", "result_type": "number"}], "name": "format", "type": "function", "result_type": "text"}], "name": "add", "type": "operator", "operator": "+", "result_type": "text"}
      - Total Monthly Income: rollup  sum of Monthly Income→PZeF (number)
      - Month Number: number
      - Name: title
      * 'All Months' [gallery] shows=['Name', 'Monthly Income (Formatted)', 'Monthly Expenses (Formatted)', 'Monthly Net (Formatted)'] gallery_cover_size="small"
      * 'Q1' [gallery] filter={"filters": [{"filter": {"value": {"type": "exact", "value": "January"}, "operator": "string_contains"}, "property": "Name"}, {"filter": {"value": {"type": "exact", "value": "February"}, "operator": "string_contains"}, "property": "Name"}, {"filter": {"value": {"type": "exact", "value": "March"}, "operator": "string_contains"}, "property": "Name"}], "operator": "or"} shows=['Name', 'Monthly Income (Formatted)', 'Monthly Expenses (Formatted)', 'Monthly Net (Formatted)'] gallery_cover_size="small"
      * 'Q2' [gallery] filter={"filters": [{"filter": {"value": {"type": "exact", "value": "April"}, "operator": "string_contains"}, "property": "Name"}, {"filter": {"value": {"type": "exact", "value": "May"}, "operator": "string_contains"}, "property": "Name"}, {"filter": {"value": {"type": "exact", "value": "June"}, "operator": "string_contains"}, "property": "Name"}], "operator": "or"} shows=['Name', 'Monthly Income (Formatted)', 'Monthly Expenses (Formatted)', 'Monthly Net (Formatted)'] gallery_cover_size="small"
      * 'Q3' [gallery] filter={"filters": [{"filter": {"value": {"type": "exact", "value": "July"}, "operator": "string_contains"}, "property": "Name"}, {"filter": {"value": {"type": "exact", "value": "August"}, "operator": "string_contains"}, "property": "Name"}, {"filter": {"value": {"type": "exact", "value": "September"}, "operator": "string_contains"}, "property": "Name"}], "operator": "or"} shows=['Name', 'Monthly Income (Formatted)', 'Monthly Expenses (Formatted)', 'Monthly Net (Formatted)'] gallery_cover_size="small"
      * 'Q4' [gallery] filter={"filters": [{"filter": {"value": {"type": "exact", "value": "October"}, "operator": "string_contains"}, "property": "Name"}, {"filter": {"value": {"type": "exact", "value": "November"}, "operator": "string_contains"}, "property": "Name"}, {"filter": {"value": {"type": "exact", "value": "December"}, "operator": "string_contains"}, "property": "Name"}], "operator": "or"} shows=['Name', 'Monthly Income (Formatted)', 'Monthly Expenses (Formatted)', 'Monthly Net (Formatted)'] gallery_cover_size="small"
  [columns]
    [column 0.5]
      [DATABASE] 'Income' cid=c9215b80 (inline)
          - Tags: select  [Salary, Bonus, Freelance, Dividends, Interest, Side Hustle]
          - Amount: number  (dollar)
          - Date: date
          - Month: relation  → Total Savings (back: Monthly Income)
          - Source: title
          * 'Q1' [table] sort=Date ascending agg=sum(Amount) shows=['Source', 'Amount', 'Tags', 'Date', 'BBUD']
          * 'Q2' [table] sort=Date ascending shows=['Source', 'Amount', 'Tags', 'Date']
          * 'Q3' [table] sort=Date ascending shows=['Source', 'Amount', 'Tags', 'Date']
          * 'Q4' [table] sort=Date ascending shows=['Source', 'Amount', 'Tags', 'Date']
          * 'All Months' [table] sort=Date ascending shows=['Source', 'Amount', 'Tags', 'Date', 'Month']
    [column 0.5]
      [DATABASE] 'Expenses' cid=d752e68e (inline)
          - Month: relation  → Total Savings (back: Monthly Expenses)
          - Amount: number  (dollar)
          - Tags: select  [Rent/Mortgage, Utilities, Groceries, Dining Out, Healthcare, Transportation, Insurance, Entertainment, Retail]
          - Date: date
          - Source: title
          * 'Q1' [table] sort=Date ascending shows=['Source', 'Amount', 'Tags', 'Date']
          * 'Q2' [table] sort=Date ascending shows=['Source', 'Amount', 'Tags', 'Date']
          * 'Q3' [table] sort=Date ascending shows=['Source', 'Amount', 'Tags', 'Date']
          * 'Q4' [table] sort=Date ascending shows=['Source', 'Amount', 'Tags', 'Date']
          * 'All Months' [table] sort=Date ascending shows=['Source', 'Amount', 'Tags', 'Date', 'Month']
```

### Formulas and rollups

```
=== FORMULAS
Total Savings.Total Monthly Expenses = sum(Monthly Expenses → Amount)
Total Savings.Monthly Net (Formatted) = "Net: $" + format(round(prop(Monthly Net)))
Total Savings.Monthly Expenses (Formatted) = "Expenses: $" + format(round(prop(Total Monthly Expenses)))
Total Savings.Monthly Net = prop(Total Monthly Income)-prop(Total Monthly Expenses) [format dollar]
Total Savings.Monthly Income (Formatted) = "Income: $" + format(round(prop(Total Monthly Income)))
Total Savings.Total Monthly Income = sum(Monthly Income → Amount)

```

