
        /* ==========================================================================
           1. ESTADO GLOBAL E INICIALIZAÇÃO
           ========================================================================== */
        
        // Data base padrão solicitada: 03 de outubro de 2026 como plantão do ciclo 24x72h.
        let baseDutyDate = amtStorage.getItem('amt_base_date') || '';
        
        // Data atual selecionada na navegação (mês/ano)
        let currentDate = new Date();
        
        // Modo de Visualização: 'month' ou 'year'
        let currentView = 'month';

        // Armazenamento de Dados de Dias Salvos
        let eventsData = JSON.parse(amtStorage.getItem('amt_events_data')) || {}; window.getEscalaEventsData = () => eventsData;

        // Dia temporário sendo editado no modal
        let selectedDateStr = '';
        let currentAttachments = [];
        let reminderTimer = null;

        // PWA: registra o service worker quando servido por HTTPS ou localhost.
        let pinUnlocked = true;

        // Inicializador
        window.amtStart = function() {
            // Inicia o contador antes de qualquer rotina de interface, para que um erro
            // em relatórios/configurações não impeça a contagem regressiva.
            const runCountdownSafely = () => {
                try {
                    updateCountdown();
                } catch (error) {
                    console.error('Erro ao atualizar o contador regressivo:', error);
                }
            };
            runCountdownSafely();
            setInterval(runCountdownSafely, 1000);

            initTheme();
            const settingsBaseInput = document.getElementById('settingsBaseDateInput');
            if (settingsBaseInput) settingsBaseInput.value = baseDutyDate;
            document.getElementById('reportMonth').value = `${currentDate.getFullYear()}-${String(currentDate.getMonth()+1).padStart(2,'0')}`;
            
            setupSettingsScreen();
            renderApp();
            refreshManagementPanel();
            
            document.addEventListener('visibilitychange', () => { if (!document.hidden) updateCountdown(); });
            window.addEventListener('focus', updateCountdown);
            setInterval(checkReminder, 60000);
            setInterval(refreshManagementPanel, 30000);
        };

        /* ==========================================================================
           2. SISTEMA DE TEMAS (LIGHT / DARK)
           ========================================================================== */
        function initTheme() {
            const savedTheme = amtStorage.getItem('amt_theme');
            if (savedTheme === 'light') {
                document.documentElement.classList.remove('dark');
            } else {
                document.documentElement.classList.add('dark');
            }
        }

        function toggleTheme() {
            if (document.documentElement.classList.contains('dark')) {
                document.documentElement.classList.remove('dark');
                amtStorage.setItem('amt_theme', 'light');
            } else {
                document.documentElement.classList.add('dark');
                amtStorage.setItem('amt_theme', 'dark');
            }
        }

        /* ==========================================================================
           3. CÁLCULO DE ESCALA 24x72h
           ========================================================================== */
        function getDaysDifference(d1, d2) {
            const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
            const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
            return Math.floor((utc2 - utc1) / (1000 * 60 * 60 * 24));
        }

        function isScheduledDutyDay(targetDate) {
            let profile = {};
            try { profile = JSON.parse(amtStorage.getItem('amt_agent_profile_v35') || '{}'); } catch (_) {}
            const monthKey = targetDate.getFullYear() + '-' + String(targetDate.getMonth()+1).padStart(2,'0');
            let configs = [];
            try { configs = JSON.parse(amtStorage.getItem('amt_month_scales') || '[]'); } catch (_) {}
            const cfg = configs.filter(c => monthKey >= c.startMonth && monthKey <= c.endMonth)
                .sort((a,b)=>b.startMonth.localeCompare(a.startMonth))[0];
            const anchor = cfg ? cfg.baseDate : '';
            if (!anchor) return false;
            const baseParts = anchor.split('-');
            const base = new Date(Number(baseParts[0]), Number(baseParts[1])-1, Number(baseParts[2]));
            const diffDays = getDaysDifference(base, targetDate);
            const scale = cfg.scale;
            if (scale === 'administrativo') return targetDate.getDay() >= 1 && targetDate.getDay() <= 5;
            const cycleDays = {'24x72':4, '12x36':2, '24x48':3, '24x96':5, '12x60':3, 'outra':4}[scale] || 4;
            return ((diffDays % cycleDays) + cycleDays) % cycleDays === 0;
        }

        let jumpTargetDate = '';
        function openMonthTools() {
            const modal=document.getElementById('monthToolsModal');
            document.getElementById('monthToolsTitle').textContent=currentDate.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
            modal.classList.remove('hidden'); modal.classList.add('flex');
        }
        function closeMonthTools(){const m=document.getElementById('monthToolsModal');m.classList.add('hidden');m.classList.remove('flex');}
        function configureCurrentMonthScale(){
            closeMonthTools();
            const mk=currentDate.getFullYear()+'-'+String(currentDate.getMonth()+1).padStart(2,'0');
            document.getElementById('monthScaleModalTitle').textContent=currentDate.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
            document.getElementById('monthScaleType').value='24x72';
            document.getElementById('monthScaleBaseDate').value='';
            const modal=document.getElementById('monthScaleModal');modal.classList.remove('hidden');modal.classList.add('flex');
        }
        function closeMonthScaleModal(){const m=document.getElementById('monthScaleModal');m.classList.add('hidden');m.classList.remove('flex');}
        function saveMonthScaleFromCalendar(){
            const start=currentDate.getFullYear()+'-'+String(currentDate.getMonth()+1).padStart(2,'0');
            const baseDate=document.getElementById('monthScaleBaseDate').value,scale=document.getElementById('monthScaleType').value;
            if(!baseDate){alert('Informe a data de um plantão conhecido neste mês.');return;}
            if(baseDate.slice(0,7)!==start){alert('A data de referência precisa estar dentro do mês configurado.');return;}
            let configs=[];try{configs=JSON.parse(amtStorage.getItem('amt_month_scales')||'[]');}catch(_){}
            const conflicts=configs.filter(c=>start>=c.startMonth&&start<=c.endMonth);
            if(conflicts.length){
                const monthLabel=currentDate.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
                if(!confirm('Já existe uma escala configurada para '+monthLabel+'. Deseja substituir somente a configuração deste mês? As configurações dos outros meses serão preservadas.'))return;
                const kept=[];
                configs.forEach(c=>{
                    if(start<c.startMonth||start>c.endMonth){kept.push(c);return;}
                    const prev=new Date(Number(start.slice(0,4)),Number(start.slice(5,7))-2,1);prev.setDate(1);
                    const next=new Date(Number(start.slice(0,4)),Number(start.slice(5,7)),1);
                    const prevKey=prev.getFullYear()+'-'+String(prev.getMonth()+1).padStart(2,'0');
                    const nextKey=next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0');
                    if(c.startMonth<start)kept.push({...c,endMonth:prevKey});
                    if(c.endMonth>start)kept.push({...c,startMonth:nextKey});
                });
                configs=kept;
            }
            configs.push({startMonth:start,endMonth:start,baseDate,scale});configs.sort((a,b)=>a.startMonth.localeCompare(b.startMonth));
            amtStorage.setItem('amt_month_scales',JSON.stringify(configs));closeMonthScaleModal();renderSavedScaleConfigs();renderApp();updateCountdown();alert('Escala configurada somente para '+start+'.');
        }
        function saveMonthlyScaleFromSettings(){
            const start=document.getElementById('monthlyScaleMonth').value;
            const baseDate=document.getElementById('monthlyScaleBaseDate').value;
            const scale=document.getElementById('monthlyScaleType').value;
            if(!start||!scale||!baseDate){alert('Selecione o mês, a escala e a data de um plantão conhecido.');return;}
            if(baseDate.slice(0,7)!==start){alert('A data de plantão precisa estar dentro do mês escolhido.');return;}
            let configs=[];try{configs=JSON.parse(amtStorage.getItem('amt_month_scales')||'[]');}catch(_){configs=[];}
            const conflicts=configs.filter(c=>start>=c.startMonth&&start<=c.endMonth);
            if(conflicts.length&&!confirm('Já existe uma configuração para esse mês. Deseja substituí-la? Os outros meses serão preservados.'))return;
            const kept=[];configs.forEach(c=>{if(start<c.startMonth||start>c.endMonth){kept.push(c);return;}const prev=new Date(Number(start.slice(0,4)),Number(start.slice(5,7))-2,1);const next=new Date(Number(start.slice(0,4)),Number(start.slice(5,7)),1);const pk=prev.getFullYear()+'-'+String(prev.getMonth()+1).padStart(2,'0');const nk=next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0');if(c.startMonth<start)kept.push({...c,endMonth:pk});if(c.endMonth>start)kept.push({...c,startMonth:nk});});
            kept.push({startMonth:start,endMonth:start,baseDate,scale});kept.sort((a,b)=>a.startMonth.localeCompare(b.startMonth));amtStorage.setItem('amt_month_scales',JSON.stringify(kept));renderSavedScaleConfigs();renderApp();updateCountdown();alert('Configuração mensal salva com sucesso.');
        }
        function saveCustomScaleConfigSeparated(){
            const start=document.getElementById('customScaleStartMonth').value,end=document.getElementById('customScaleEndMonth').value,baseDate=document.getElementById('customScaleBaseDate').value,scale=document.getElementById('customScaleType').value;
            if(!start||!end||!baseDate){alert('Preencha o mês inicial, o mês final e a data de um plantão conhecido.');return;}
            if(end<start){alert('O mês final não pode ser anterior ao mês inicial.');return;}
            if(baseDate.slice(0,7)<start||baseDate.slice(0,7)>end){alert('A data de plantão precisa estar dentro do período configurado.');return;}
            let configs=[];try{configs=JSON.parse(amtStorage.getItem('amt_month_scales')||'[]');}catch(_){configs=[];}
            const conflicts=configs.filter(c=>!(end<c.startMonth||start>c.endMonth));
            if(conflicts.length&&!confirm('O período informado conflita com uma ou mais configurações existentes. Deseja substituir as configurações dos meses afetados?'))return;
            const kept=[];configs.forEach(c=>{if(end<c.startMonth||start>c.endMonth){kept.push(c);return;}const prev=new Date(Number(start.slice(0,4)),Number(start.slice(5,7))-2,1);const next=new Date(Number(end.slice(0,4)),Number(end.slice(5,7)),1);const pk=prev.getFullYear()+'-'+String(prev.getMonth()+1).padStart(2,'0');const nk=next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0');if(c.startMonth<start)kept.push({...c,endMonth:pk});if(c.endMonth>end)kept.push({...c,startMonth:nk});});
            kept.push({startMonth:start,endMonth:end,baseDate,scale});kept.sort((a,b)=>a.startMonth.localeCompare(b.startMonth));amtStorage.setItem('amt_month_scales',JSON.stringify(kept));renderSavedScaleConfigs();renderApp();updateCountdown();alert('Configuração personalizada salva com sucesso.');
        }
        function initializeSeparatedScaleForms(){
            const month=document.getElementById('monthlyScaleMonth');if(month&&month.options.length===1){const now=new Date();for(let i=-2;i<25;i++){const d=new Date(now.getFullYear(),now.getMonth()+i,1);const v=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');const o=document.createElement('option');o.value=v;o.textContent=d.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});month.appendChild(o);}month.value=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');}
            const now=new Date(),mk=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');['customScaleStartMonth','customScaleEndMonth'].forEach(id=>{const e=document.getElementById(id);if(e&&!e.value)e.value=mk;});
        }
        function cancelMonthChoice(target){const el=typeof target==='string'?document.getElementById(target):target;if(el){el.value='';if(el.id==='settingsScaleStartMonth'||el.id==='settingsScaleEndMonth')updateScaleConfigFields();}}
        function cancelScaleConfigForm(){ initializeSeparatedScaleForms(); }
        function updateScaleConfigFields(){ initializeSeparatedScaleForms(); }
        function saveCustomScaleConfig(){
            const mode=document.getElementById('settingsScaleMode').value,start=document.getElementById('settingsScaleStartMonth').value;
            const end=mode==='month'?start:document.getElementById('settingsScaleEndMonth').value;
            const baseDate=document.getElementById('settingsScaleBaseDate').value,scale=document.getElementById('settingsScaleType').value;
            if(!mode||!scale||!start||!end||!baseDate){alert('Selecione o tipo de configuração, a escala, o mês e a data de plantão conhecido.');return;}
            if(end<start){alert('O mês final não pode ser anterior ao mês inicial.');return;}
            if(baseDate.slice(0,7)<start||baseDate.slice(0,7)>end){alert('A data de plantão precisa estar dentro do período configurado.');return;}
            let configs=[];try{configs=JSON.parse(amtStorage.getItem('amt_month_scales')||'[]');}catch(_){}
            const conflicts=configs.filter(c=>!(end<c.startMonth||start>c.endMonth));
            if(conflicts.length){
                const affected=[];let cursor=new Date(Number(start.slice(0,4)),Number(start.slice(5,7))-1,1);const finish=new Date(Number(end.slice(0,4)),Number(end.slice(5,7))-1,1);
                while(cursor<=finish){const key=cursor.getFullYear()+'-'+String(cursor.getMonth()+1).padStart(2,'0');if(conflicts.some(c=>key>=c.startMonth&&key<=c.endMonth))affected.push(key);cursor.setMonth(cursor.getMonth()+1);}
                const affectedLabel=affected.map(k=>{const [y,m]=k.split('-');return new Date(+y,+m-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});}).join(', ');
                if(!confirm('Já existe uma escala configurada para '+affectedLabel+'. Deseja substituir a configuração dos meses indicados? Se cancelar, a escala atual será mantida. Os meses fora do período serão preservados.'))return;
                const kept=[];
                configs.forEach(c=>{
                    if(end<c.startMonth||start>c.endMonth){kept.push(c);return;}
                    const prev=new Date(Number(start.slice(0,4)),Number(start.slice(5,7))-2,1);const next=new Date(Number(end.slice(0,4)),Number(end.slice(5,7)),1);
                    const prevKey=prev.getFullYear()+'-'+String(prev.getMonth()+1).padStart(2,'0');const nextKey=next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0');
                    if(c.startMonth<start)kept.push({...c,endMonth:prevKey});if(c.endMonth>end)kept.push({...c,startMonth:nextKey});
                });configs=kept;
            }
            configs.push({startMonth:start,endMonth:end,baseDate,scale});configs.sort((a,b)=>a.startMonth.localeCompare(b.startMonth));
            amtStorage.setItem('amt_month_scales',JSON.stringify(configs));renderSavedScaleConfigs();renderApp();updateCountdown();
            cancelScaleConfigForm();
            alert('Escala salva de '+start+' até '+end+'. As demais configurações foram preservadas.');
        }
        function renderSavedScaleConfigs(){const el=document.getElementById('savedScaleConfigs');if(el){el.innerHTML='';el.classList.add('hidden');}updateProfileScaleDisplay();}
        function updateProfileScaleDisplay(){
            const display=document.getElementById('profileScaleDisplay');if(!display)return;let a=[];try{a=JSON.parse(amtStorage.getItem('amt_month_scales')||'[]')}catch(_){}
            if(!a.length){display.textContent='Escala: não configurada';return;}
            const scale=a[a.length-1].scale;display.textContent='Escala: '+(scale==='administrativo'?'Administrativo':scale+'h');
        }
        function clearSpecificScaleMonth(){
            const month=document.getElementById('clearScaleMonth').value;if(!month){alert('Selecione o mês cuja escala deseja limpar.');return;}
            let configs=[];try{configs=JSON.parse(amtStorage.getItem('amt_month_scales')||'[]')}catch(_){}
            const matches=configs.some(c=>month>=c.startMonth&&month<=c.endMonth);if(!matches){alert('Não há escala configurada para esse mês.');return;}
            const [yy,mm]=month.split('-').map(Number);const label=new Date(yy,mm-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
            if(!confirm('Deseja limpar a configuração da escala de '+label+'? Os outros meses serão preservados.'))return;
            const kept=[];configs.forEach(c=>{if(month<c.startMonth||month>c.endMonth){kept.push(c);return;}const prev=new Date(yy,mm-2,1);const next=new Date(yy,mm,1);const prevKey=prev.getFullYear()+'-'+String(prev.getMonth()+1).padStart(2,'0');const nextKey=next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0');if(c.startMonth<month)kept.push({...c,endMonth:prevKey});if(c.endMonth>month)kept.push({...c,startMonth:nextKey});});
            amtStorage.setItem('amt_month_scales',JSON.stringify(kept));document.getElementById('clearScaleMonth').value='';renderSavedScaleConfigs();renderApp();updateCountdown();alert('Configuração de '+label+' removida.');
        }
        async function clearAllScaleConfigs(){let configs=[];try{configs=JSON.parse(amtStorage.getItem('amt_month_scales')||'[]')}catch(_){};if(!configs.length){alert('Não há escalas configuradas para limpar.');return;}if(!confirm('Tem certeza de que deseja resetar TODAS as escalas configuradas? Essa ação não pode ser desfeita.'))return;if(!await amtPrevent())return;amtStorage.removeItem('amt_month_scales');document.getElementById('clearScaleMonth').value='';renderSavedScaleConfigs();renderApp();updateCountdown();alert('Todas as configurações de escala foram removidas.');}

        // Identifica cada troca como um único par de datas, mesmo que ela apareça nos dois dias.
        function getSwapPairKey(dateKey, swap) {
            if (!swap || !swap.active) return '';
            if (swap.groupId) return String(swap.groupId);
            const other = String(swap.otherDate || '');
            return other ? [dateKey, other].sort().join('|') : dateKey;
        }
        function countUniqueSwapsInMonth(year, monthIndex) {
            const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}-`;
            const pairs = new Set();
            Object.entries(eventsData).forEach(([key, ev]) => {
                if (key.startsWith(prefix) && ev?.swap?.active) {
                    pairs.add(getSwapPairKey(key, ev.swap));
                }
            });
            return pairs.size;
        }

        function getSwapRole(targetDate) {
            const key = formatDateKey(targetDate);
            const swap = eventsData[key]?.swap;
            if (!swap || !swap.active) return '';
            if (swap.role === 'working_for' || swap.role === 'covered_by_agent') return swap.role;
            // Compatibilidade com trocas antigas sem papel explícito: a primeira data é
            // a data trabalhada pelo usuário; a segunda é o plantão coberto pelo colega.
            if (swap.otherDate) return key < swap.otherDate ? 'working_for' : 'covered_by_agent';
            return 'working_for';
        }

        function isDutyDay(targetDate) {
            const key = formatDateKey(targetDate);
            const event = eventsData[key] || {};
            if (event.dayOff === true) return false;
            if (getSwapRole(targetDate) === 'covered_by_agent') return false;
            return isScheduledDutyDay(targetDate);
        }

        function hasExtraShift(targetDate) {
            const event = eventsData[formatDateKey(targetDate)];
            return !!(event && event.dayOff !== true && event.extra && event.extra.type === 'shift');
        }

        function isRegisteredAgent(agentName) {
            // A troca conta para o contador quando o agente informado nela
            // corresponde ao nome de guerra/nome cadastrado neste aplicativo.
            // Ignora maiúsculas, acentos e espaços extras; aceita nome completo
            // ou nome de guerra quando um contém o outro.
            const normalizeAgentName = value => String(value || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLocaleLowerCase('pt-BR')
                .replace(/\s+/g, ' ')
                .trim();
            const swapName = normalizeAgentName(agentName);
            let registeredName = '';
            try {
                const profile = JSON.parse(amtStorage.getItem('amt_agent_profile_v35') || 'null');
                registeredName = normalizeAgentName(profile && profile.name);
            } catch (error) {
                registeredName = '';
            }
            return !!(swapName && registeredName &&
                (swapName === registeredName || swapName.includes(registeredName) || registeredName.includes(swapName)));
        }

        function getWorkReason(targetDate) {
            const key = formatDateKey(targetDate);
            const event = eventsData[key] || {};
            if (event.dayOff === true) return '';

            const swap = event.swap;
            const swapRole = getSwapRole(targetDate);
            // Uma data laranja conta como plantão do usuário quando o agente
            // informado na troca corresponde ao nome cadastrado neste aplicativo.
            // Se for outro agente, o contador procura a próxima obrigação válida.
            if (swap && swap.active) {
                return isRegisteredAgent(swap.agent) ? 'swap' : '';
            }
            if (swapRole === 'covered_by_agent') return '';
            if (event.extra && event.extra.type === 'shift') return 'extra';
            if (isScheduledDutyDay(targetDate)) return 'normal';
            return '';
        }

        function isWorkDay(targetDate) {
            return !!getWorkReason(targetDate);
        }

        /* ==========================================================================
           4. RENDERIZAÇÃO DA INTERFACE (MÊS E ANO)
           ========================================================================== */
        function renderApp() {
            updatePeriodLabel();
            if (currentView === 'month') {
                document.getElementById('monthView').classList.remove('hidden');
                document.getElementById('yearView').classList.add('hidden');
                renderMonthGrid();
            } else {
                document.getElementById('monthView').classList.add('hidden');
                document.getElementById('yearView').classList.remove('hidden');
                renderYearGrid();
            }
            calculateMonthlyStats();
            if(typeof renderHolidayList==='function')renderHolidayList();
        }

        function switchView(view) {
            currentView = view;
            const btnMonth = document.getElementById('btnViewMonth');
            const btnYear = document.getElementById('btnViewYear');

            if (view === 'month') {
                btnMonth.className = "flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-semibold transition bg-[#F8F5ED] dark:bg-[#211F1B] text-gray-900 dark:text-white shadow-sm";
                btnYear.className = "flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-semibold transition text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";
            } else {
                btnYear.className = "flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-semibold transition bg-[#F8F5ED] dark:bg-[#211F1B] text-gray-900 dark:text-white shadow-sm";
                btnMonth.className = "flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-semibold transition text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";
            }
            renderApp();
        }

        function navigateDate(offset) {
            if (currentView === 'month') {
                currentDate.setMonth(currentDate.getMonth() + offset);
            } else {
                currentDate.setFullYear(currentDate.getFullYear() + offset);
            }
            renderApp();
        }

        function goToToday() {
            currentDate = new Date();
            renderApp();
        }

        function updatePeriodLabel() {
            const label = document.getElementById('currentPeriodLabel');
            if (currentView === 'month') {
                const monthName = currentDate.toLocaleDateString('pt-BR', { month: 'long' });
                label.innerText = `${monthName} ${currentDate.getFullYear()}`;
            } else {
                label.innerText = `${currentDate.getFullYear()}`;
            }
        }

        function renderMonthGrid() {
            const grid = document.getElementById('monthGrid');
            grid.innerHTML = '';

            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();

            const firstDayIndex = new Date(year, month, 1).getDay();
            const totalDays = new Date(year, month + 1, 0).getDate();

            const prevMonthDays = new Date(year, month, 0).getDate();
            for (let i = firstDayIndex - 1; i >= 0; i--) {
                const dayNum = prevMonthDays - i;
                const prevDate = new Date(year, month - 1, dayNum);
                const cell = createDayCell(prevDate, true);
                grid.appendChild(cell);
            }

            const today = new Date();
            for (let d = 1; d <= totalDays; d++) {
                const thisDate = new Date(year, month, d);
                const isToday = thisDate.toDateString() === today.toDateString();
                const cell = createDayCell(thisDate, false, isToday);
                grid.appendChild(cell);
            }

            const totalCells = firstDayIndex + totalDays;
            const nextDays = (7 - (totalCells % 7)) % 7;
            for (let n = 1; n <= nextDays; n++) {
                const nextDate = new Date(year, month + 1, n);
                const cell = createDayCell(nextDate, true);
                grid.appendChild(cell);
            }
        }

        function easterSunday(year){const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;return new Date(year,month-1,day);}
        function getHolidayForDate(dateObj){const y=dateObj.getFullYear(),m=dateObj.getMonth()+1,d=dateObj.getDate(),key=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const fixed={
          '01-01':['Confraternização Universal','Nacional'],'03-19':['Dia de São José','Municipal (Eusébio)'],'03-25':['Data Magna do Ceará','Estadual'],'04-21':['Tiradentes','Nacional'],'05-01':['Dia do Trabalho','Nacional'],'06-23':['Dia do Município de Eusébio','Municipal'],'07-26':['Nossa Senhora de Santana — Padroeira de Eusébio','Municipal'],'09-07':['Independência do Brasil','Nacional'],'10-12':['Nossa Senhora Aparecida','Nacional'],'11-02':['Finados','Nacional'],'11-15':['Proclamação da República','Nacional'],'11-20':['Dia Nacional de Zumbi e da Consciência Negra','Nacional'],'12-25':['Natal','Nacional']};
          const f=fixed[`${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`];if(f)return {name:f[0],scope:f[1]};const easter=easterSunday(y);const goodFriday=new Date(easter);goodFriday.setDate(easter.getDate()-2);if(dateObj.toDateString()===goodFriday.toDateString())return {name:'Sexta-feira Santa — Paixão de Cristo',scope:'Religioso'};return null;}
        function renderHolidayList(){const root=document.getElementById('holidayList');if(!root)return;const y=currentDate.getFullYear(),month=currentDate.getMonth();document.getElementById('holidayListYear').textContent=currentView==='year'?String(y):currentDate.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});const list=[];for(let m=0;m<12;m++){if(currentView==='month'&&m!==month)continue;const days=new Date(y,m+1,0).getDate();for(let d=1;d<=days;d++){const dt=new Date(y,m,d),h=getHolidayForDate(dt);if(h)list.push({dt,h});}}root.innerHTML='';if(!list.length){root.innerHTML='<p class="text-sm text-gray-500">Nenhum feriado cadastrado neste período.</p>';return;}list.forEach(({dt,h})=>{const item=document.createElement('div');item.className='flex items-center justify-between gap-3 rounded-xl bg-white/70 dark:bg-black/20 border border-gray-200 dark:border-gray-700 px-3 py-2';item.innerHTML=`<span class="font-bold tabular-nums">${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}</span><span class="flex-1">${h.name}</span><span class="text-[10px] text-gray-500">${h.scope}</span>`;root.appendChild(item);});}

        function createDayCell(dateObj, isOtherMonth, isToday = false) {
            const cell = document.createElement('div');
            const dateKey = formatDateKey(dateObj);
            const onDuty = isDutyDay(dateObj);
            const data = eventsData[dateKey] || {};

            const hasExtra = data.extra && data.extra.type !== 'none';
            const hasExtraShiftDay = !!(data.extra && data.extra.type === 'shift');
            const hasExtraHours = !!(data.extra && data.extra.type === 'hours');
            const isSwapDay = !!(data.swap && data.swap.active);

            let bgClasses = isOtherMonth
                ? "bg-gray-50 dark:bg-gray-900/30 text-gray-400 opacity-40"
                : "bg-gray-100 dark:bg-[#222228] text-gray-800 dark:text-gray-200 hover:border-amber-500 cursor-pointer";

            if (!isOtherMonth) {
                if (data.dayOff === true) {
                    // Folga manual tem prioridade sobre as cores de plantão/troca.
                    bgClasses = "bg-gray-100 dark:bg-[#222228] text-gray-800 dark:text-gray-200 hover:border-amber-500 cursor-pointer";
                } else if (isSwapDay) {
                    // Laranja escuro no dia em que o servidor cadastrado vai trabalhar;
                    // laranja suave no dia original em que ficará de folga.
                    bgClasses = isRegisteredAgent(data.swap.agent)
                        ? "bg-orange-700 text-white font-extrabold shadow-md hover:bg-orange-800 cursor-pointer ring-1 ring-orange-500"
                        : "bg-orange-200 text-orange-950 font-bold shadow-sm hover:bg-orange-300 cursor-pointer ring-1 ring-orange-300";
                } else if (hasExtraShiftDay) {
                    // Plantão extra de 24h: amarelo.
                    bgClasses = "bg-yellow-400 text-gray-950 font-extrabold shadow-md hover:bg-yellow-300 cursor-pointer ring-1 ring-yellow-500";
                } else if (hasExtraHours) {
                    // Dias com horas extras ficam verdes no calendário.
                    bgClasses = "bg-green-500 text-white font-extrabold shadow-md hover:bg-green-600 cursor-pointer ring-1 ring-green-600";
                } else if (onDuty) {
                    bgClasses = "bg-blue-600 text-white font-bold shadow-md hover:bg-blue-700 cursor-pointer";
                }
            }

            if (dateKey === jumpTargetDate) {
                bgClasses += " ring-2 ring-amber-400 ring-offset-2 ring-offset-white dark:ring-offset-[#18181C]";
            } else if (isToday) {
                bgClasses += " ring-2 ring-amber-400 ring-offset-2 ring-offset-white dark:ring-offset-[#18181C]";
            }

            cell.className = `min-h-[72px] sm:min-h-[85px] p-1.5 sm:p-2 rounded-xl flex flex-col justify-between transition border border-transparent select-none touch-manipulation ${bgClasses}`;
            cell.dataset.dateKey = dateKey;
            // Toque/clique simples abre imediatamente as configurações do dia.
            // Não exige pressionar por meio segundo.
            cell.addEventListener('contextmenu', e => e.preventDefault());
            cell.onclick = () => openDayModal(dateObj, cell);

            // Trocas não exibem bolinhas. Horas extras e plantões extras de 24h
            // usam preto para 50% e vermelho para 100%.
            let badgesHtml = '';
            if (!isSwapDay && (hasExtraHours || hasExtraShiftDay)) {
                const rate = String(data.extra.rate || '50');
                const badgeColor = rate === '100' ? 'bg-red-600' : 'bg-black';
                const badgeLabel = hasExtraShiftDay ? `Plantão extra 24h ${rate}%` : `Hora extra ${rate}%`;
                badgesHtml = `<span class="w-2.5 h-2.5 rounded-full ${badgeColor} ${rate === '50' ? 'border border-gray-400' : ''}" title="${badgeLabel}" aria-label="${badgeLabel}"></span>`;
            }

            let attachIcon = '';
            if ((data.attachments && data.attachments.length > 0) || (data.note && data.note.trim() !== '')) {
                attachIcon = `<i class="fa-solid fa-paperclip text-[10px] opacity-75"></i>`;
            }

            let statusLabel = '';
            if (!isOtherMonth) {
                if (data.dayOff === true) {
                    statusLabel = 'Folga';
                } else if (data.swap && data.swap.active) {
                    statusLabel = data.swap.agent || 'TROCA';
                } else if (hasExtraShiftDay) {
                    statusLabel = 'EXTRA 24H';
                } else if (hasExtraHours) {
                    statusLabel = 'HORA EXTRA';
                } else if (onDuty) {
                    statusLabel = 'PLANTÃO';
                } else {
                    statusLabel = 'Folga';
                }
            }

            cell.innerHTML = `
                <div class="flex items-center justify-between">
                    <span class="text-xs sm:text-sm font-extrabold ${getHolidayForDate(dateObj)?'!text-red-600 dark:!text-red-400':''}" title="${getHolidayForDate(dateObj)?getHolidayForDate(dateObj).name:''}">${dateObj.getDate()}</span>
                    <div class="flex items-center gap-1">
                        ${badgesHtml}
                    </div>
                </div>
                
                <div class="text-[10px] sm:text-[11px] font-medium leading-tight truncate">
                    ${statusLabel}
                </div>

                <div class="flex items-center justify-between text-[9px] opacity-80 mt-1">
                    <span>${hasExtra ? `+${data.extra.hours || 24}h` : ''}</span>
                    <span>${attachIcon}</span>
                </div>
            `;

            return cell;
        }

        function renderYearGrid() {
            const container = document.getElementById('yearView');
            container.innerHTML = '';

            const currentYear = currentDate.getFullYear();

            for (let monthIdx = 0; monthIdx < 12; monthIdx++) {
                const monthCard = document.createElement('div');
                monthCard.className = "bg-[#F8F5ED] dark:bg-[#211F1B] p-3 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm";

                const monthName = new Date(currentYear, monthIdx, 1).toLocaleDateString('pt-BR', { month: 'long' });

                let daysGridHtml = '';
                const firstDayIndex = new Date(currentYear, monthIdx, 1).getDay();
                const totalDays = new Date(currentYear, monthIdx + 1, 0).getDate();

                for (let e = 0; e < firstDayIndex; e++) {
                    daysGridHtml += `<div class="h-6"></div>`;
                }

                for (let day = 1; day <= totalDays; day++) {
                    const thisDate = new Date(currentYear, monthIdx, day);
                    const duty = isDutyDay(thisDate);
                    const ev = eventsData[formatDateKey(thisDate)] || {};
                    const hasExtraShiftYear = ev.extra && ev.extra.type === 'shift';
                    let bg = duty ? 'bg-blue-600 text-white font-bold' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
                    if (ev.dayOff === true) bg = 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
                    if (ev.swap && ev.swap.active) bg = isRegisteredAgent(ev.swap.agent) ? 'bg-orange-700 text-white font-bold' : 'bg-orange-200 text-orange-950 font-bold';
                    else if (ev.dayOff !== true && hasExtraShiftYear) bg = 'bg-yellow-400 text-gray-950 font-bold';
                    else if (ev.dayOff !== true && ev.extra && ev.extra.type === 'hours') bg = 'bg-green-500 text-white font-bold';

                    const holiday=getHolidayForDate(thisDate);
                    daysGridHtml += `
                        <div data-date="${currentYear}-${String(monthIdx + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}" class="year-day-cell h-6 w-full flex items-center justify-center text-[10px] rounded-md cursor-pointer select-none touch-manipulation hover:opacity-80 transition ${bg}" title="${holiday?holiday.name:''}">
                            <span class="${holiday?'!text-red-600 dark:!text-red-400':''}">${day}</span>
                        </div>
                    `;
                }

                monthCard.innerHTML = `
                    <h4 class="font-bold text-xs uppercase tracking-wider text-amber-500 mb-2 capitalize text-center">${monthName}</h4>
                    <div class="grid grid-cols-7 gap-1 text-center text-[9px] text-gray-400 font-bold mb-1">
                        <div>D</div><div>S</div><div>T</div><div>Q</div><div>Q</div><div>S</div><div>S</div>
                    </div>
                    <div class="grid grid-cols-7 gap-1">
                        ${daysGridHtml}
                    </div>
                `;

                container.appendChild(monthCard);
            }
            container.querySelectorAll('.year-day-cell').forEach(cell => {
                const dateStr = cell.dataset.date;
                cell.addEventListener('contextmenu', e => e.preventDefault());
                cell.addEventListener('click', () => openDayModalFromYear(dateStr, cell));
            });
        }

        function openDayModalFromYear(dateStr, anchorEl = null) {
            const parts = dateStr.split('-');
            const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            openDayModal(d, anchorEl);
        }

        /* ==========================================================================
           5. ESTATÍSTICAS E RESUMO MENSAL
           ========================================================================== */
        function calculateMonthlyStats() {
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const totalDays = new Date(year, month + 1, 0).getDate();

            let dutyCount = 0;
            let offCount = 0;
            let extra50Hours = 0;
            let extra100Hours = 0;
            let extraShifts = 0;
            let swappedShifts = countUniqueSwapsInMonth(year, month);

            const dutyDaysList = [];
            const offDaysList = [];
            const extraDaysList = [];
            const extraShiftDaysList = [];
            const swapDaysList = [];

            for (let d = 1; d <= totalDays; d++) {
                const dateObj = new Date(year, month, d);
                const dateKey = formatDateKey(dateObj);
                const onDuty = isDutyDay(dateObj);

                const formattedDayNumber = String(d).padStart(2, '0');

                if (onDuty) {
                    dutyCount++;
                    dutyDaysList.push(formattedDayNumber);
                } else {
                    offCount++;
                    offDaysList.push(formattedDayNumber);
                }

                const event = eventsData[dateKey] || {};
                if (event.swap && event.swap.active) { swapDaysList.push(formattedDayNumber); }
                if (event.extra && event.extra.type === 'hours') extraDaysList.push(formattedDayNumber);
                if (event.extra && event.extra.type === 'shift') extraShiftDaysList.push(formattedDayNumber);
                if (event.extra && event.extra.type !== 'none') {
                    const hours = parseInt(event.extra.hours) || (event.extra.type === 'shift' ? 24 : 0);
                    if (event.extra.rate === '50') {
                        extra50Hours += hours;
                    } else if (event.extra.rate === '100') {
                        extra100Hours += hours;
                    }
                    if (event.extra.type === 'shift') {
                        extraShifts++;
                    }
                }
            }

            document.getElementById('statDutyCount').innerText = dutyCount;
            document.getElementById('statOffCount').innerText = offCount;
            document.getElementById('statExtra50Hours').innerText = `${extra50Hours}h`;
            document.getElementById('statExtra100Hours').innerText = `${extra100Hours}h`;
            document.getElementById('statExtraShifts').innerText = extraShifts;
            document.getElementById('statSwappedShifts').innerText = swappedShifts;

            document.getElementById('listDutyDays').innerText = dutyDaysList.length > 0 
                ? dutyDaysList.join(', ') 
                : 'Nenhum plantão neste mês.';
                
            document.getElementById('listOffDays').innerText = offDaysList.length > 0
                ? offDaysList.join(', ') : 'Nenhuma folga neste mês.';
            document.getElementById('listExtraDays').innerText = extraDaysList.length > 0
                ? extraDaysList.join(', ') : 'Nenhum dia com hora extra neste mês.';
            document.getElementById('listExtraShiftDays').innerText = extraShiftDaysList.length > 0
                ? extraShiftDaysList.join(', ') : 'Nenhum plantão extra neste mês.';
            document.getElementById('listSwapDays').innerText = swapDaysList.length > 0
                ? swapDaysList.join(', ') : 'Nenhuma troca neste mês.';

            // Só exibe estas categorias quando há registros no mês selecionado.
            document.getElementById('detailExtraHoursItem').classList.toggle('hidden', extraDaysList.length === 0);
            document.getElementById('detailExtraShiftItem').classList.toggle('hidden', extraShiftDaysList.length === 0);
            document.getElementById('detailSwapItem').classList.toggle('hidden', swapDaysList.length === 0);
        }

        /* ==========================================================================
           6. CONTAGEM REGRESSIVA DO PRÓXIMO PLANTÃO (06:00 AM)
           ========================================================================== */
        function updateCountdown() {
            const now = new Date();
            const statusBadge = document.getElementById('statusBadge');
            const statusText = document.getElementById('statusText');
            const countdownTitle = document.getElementById('countdownTitle');
            const countdownFields = ['cdDays', 'cdHours', 'cdMins', 'cdSecs'];
            const shiftHours = 24;
            let activeShift = null;
            let nextShift = null;

            // Procura primeiro se existe plantão em andamento (06h até 06h do dia seguinte).
            // A função getWorkReason considera escala normal, plantão extra, troca e folga manual.
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            for (let offset = -1; offset <= 1; offset++) {
                const shiftDate = new Date(today);
                shiftDate.setDate(shiftDate.getDate() + offset);
                const reason = getWorkReason(shiftDate);
                if (!reason) continue;
                const startTime = new Date(shiftDate.getFullYear(), shiftDate.getMonth(), shiftDate.getDate(), 6, 0, 0, 0);
                const endTime = new Date(startTime.getTime() + shiftHours * 60 * 60 * 1000);
                if (now >= startTime && now < endTime) {
                    activeShift = { startTime, endTime, reason, date: shiftDate };
                    break;
                }
            }

            let targetTime = null;
            if (activeShift) {
                targetTime = activeShift.endTime;
                statusBadge.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 mb-0.5 pulse-animation';
                statusText.innerText = activeShift.reason === 'extra' ? 'EM PLANTÃO EXTRA' : activeShift.reason === 'swap' ? 'EM TROCA DE PLANTÃO' : 'EM PLANTÃO';
                countdownTitle.innerText = 'Fim do Plantão';
            } else {
                // Busca o próximo início futuro. Recalcula com os dados atuais do calendário a
                // cada segundo, então alterações, folgas, extras e trocas passam a valer na hora.
                for (let offset = 0; offset <= 730; offset++) {
                    const candidateDate = new Date(today);
                    candidateDate.setDate(candidateDate.getDate() + offset);
                    const reason = getWorkReason(candidateDate);
                    if (!reason) continue;
                    const candidateStart = new Date(candidateDate.getFullYear(), candidateDate.getMonth(), candidateDate.getDate(), 6, 0, 0, 0);
                    if (candidateStart > now) {
                        nextShift = { startTime: candidateStart, reason, date: candidateDate };
                        break;
                    }
                }
                if (nextShift) targetTime = nextShift.startTime;
                statusBadge.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 mb-0.5';
                statusText.innerText = nextShift && nextShift.reason === 'extra' ? 'PRÓXIMO: PLANTÃO EXTRA' : nextShift && nextShift.reason === 'swap' ? 'PRÓXIMO: TROCA DE PLANTÃO' : 'EM FOLGA';
                countdownTitle.innerText = nextShift && nextShift.reason === 'extra' ? 'Plantão Extra em' : nextShift && nextShift.reason === 'swap' ? 'Troca de Plantão em' : 'Próximo Plantão';
            }

            if (!targetTime) {
                countdownFields.forEach(id => { const el = document.getElementById(id); if (el) el.innerText = '00'; });
                statusText.innerText = 'SEM PLANTÃO PREVISTO';
                countdownTitle.innerText = 'Nenhum plantão nos próximos 2 anos';
                return;
            }

            const diffMs = Math.max(0, targetTime.getTime() - now.getTime());
            const days = Math.floor(diffMs / 86400000);
            const hours = Math.floor((diffMs % 86400000) / 3600000);
            const mins = Math.floor((diffMs % 3600000) / 60000);
            const secs = Math.floor((diffMs % 60000) / 1000);
            document.getElementById('cdDays').innerText = String(days).padStart(2, '0');
            document.getElementById('cdHours').innerText = String(hours).padStart(2, '0');
            document.getElementById('cdMins').innerText = String(mins).padStart(2, '0');
            document.getElementById('cdSecs').innerText = String(secs).padStart(2, '0');
        }

        /* ==========================================================================
           7. CONSULTA RÁPIDA DE DATA
           ========================================================================== */
        function checkSpecificDate() {
            const inputVal = document.getElementById('searchDateInput').value;
            if (!inputVal) return;

            const parts = inputVal.split('-');
            const targetDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            const onDuty = isDutyDay(targetDate);

            const resultContainer = document.getElementById('searchResult');
            const resultContent = document.getElementById('searchResultContent');

            resultContainer.classList.remove('hidden');

            const dateFormatted = targetDate.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

            if (onDuty) {
                resultContainer.className = "mt-3 p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-300 text-sm font-medium flex items-center justify-between";
                resultContent.innerHTML = `<i class="fa-solid fa-shield-halved text-lg"></i> <span>Em <strong>${dateFormatted}</strong> você estará de <strong>PLANTÃO (06h às 06h)</strong>.</span>`;
            } else {
                resultContainer.className = "mt-3 p-3 rounded-xl bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium flex items-center justify-between";
                resultContent.innerHTML = `<i class="fa-solid fa-mug-hot text-lg text-emerald-500"></i> <span>Em <strong>${dateFormatted}</strong> você estará de <strong>FOLGA</strong>.</span>`;
            }
        }

        function closeSearchResult() {
            document.getElementById('searchResult').classList.add('hidden');
        }

        /* ==========================================================================
           8. MODAL DE EDIÇÃO DO DIA (NOTAS, EXTRAS, TROCAS E ANEXOS)
           ========================================================================== */
        function openDayModal(dateObj, anchorEl = null) {
            if (!document.getElementById('settingsScreen').classList.contains('hidden')) closeConfigModal();
            selectedDateStr = formatDateKey(dateObj);
            const event = eventsData[selectedDateStr] || {};
            const onDuty = isDutyDay(dateObj);
            const isScheduledDuty = isScheduledDutyDay(dateObj);
            const dayOffWrap = document.getElementById('dayOffOverrideWrap');
            const dayOffCheck = document.getElementById('modalDayOffCheck');
            dayOffWrap.classList.toggle('hidden', !(isScheduledDuty || event.dayOff === true));
            dayOffCheck.checked = event.dayOff === true;

            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            document.getElementById('modalDateTitle').innerText = dateObj.toLocaleDateString('pt-BR', options);

            const headerBg = document.getElementById('modalHeaderBg');
            const modalBadge = document.getElementById('modalDayBadge');
            const statusIcon = document.getElementById('modalStatusIcon');
            const statusText = document.getElementById('modalStatusText');

            if (onDuty) {
                headerBg.className = "p-5 text-white bg-gradient-to-r from-blue-600 to-indigo-700 flex items-center justify-between";
                modalBadge.innerText = "Escala Normal - Plantão";
                statusIcon.className = "w-10 h-10 rounded-xl bg-blue-500/20 text-blue-500 flex items-center justify-center text-lg";
                statusText.innerText = "PLANTÃO DE 24H (06:00 às 06:00)";
            } else {
                headerBg.className = "p-5 text-white bg-gradient-to-r from-gray-700 to-gray-900 flex items-center justify-between";
                modalBadge.innerText = event.dayOff ? "Folga marcada manualmente" : "Escala Normal - Folga";
                statusIcon.className = "w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-500 flex items-center justify-center text-lg";
                statusText.innerText = "DIA DE FOLGA";
            }

            document.getElementById('modalNoteInput').value = event.note || '';
            const swapCheck = document.getElementById('modalSwapCheck');
            const currentSwap = event.swap && event.swap.active ? event.swap : null;
            const linkedSwap = currentSwap && currentSwap.otherDate ? (eventsData[currentSwap.otherDate]?.swap || null) : null;
            if (currentSwap) {
                swapCheck.checked = true;
                document.getElementById('modalSwapAgentOne').value = currentSwap.agent || '';
                document.getElementById('modalSwapDateOneInput').value = selectedDateStr;
                document.getElementById('modalSwapAgentTwo').value = linkedSwap?.agent || currentSwap.agentTwo || '';
                document.getElementById('modalSwapDateTwoInput').value = currentSwap.otherDate || '';
            } else {
                swapCheck.checked = false;
                document.getElementById('modalSwapAgentOne').value = '';
                document.getElementById('modalSwapDateOneInput').value = '';
                document.getElementById('modalSwapAgentTwo').value = '';
                document.getElementById('modalSwapDateTwoInput').value = '';
            }
            toggleSwapInputs();

            if (event.extra) {
                document.getElementById('modalExtraType').value = event.extra.type || 'none';
                document.getElementById('modalExtraRate').value = event.extra.rate || '50';
                document.getElementById('modalExtraHours').value = event.extra.hours ?? 0;
            } else {
                document.getElementById('modalExtraType').value = 'none';
                document.getElementById('modalExtraRate').value = '50';
                document.getElementById('modalExtraHours').value = 0;
            }

            currentAttachments = event.attachments ? [...event.attachments] : [];
            renderAttachmentsList();

            const modal = document.getElementById('dayModal');
            const panel = document.getElementById('dayModalPanel');
            modal.classList.remove('hidden');
            // Posiciona o menu perto do dia escolhido, mantendo-o dentro da tela.
            panel.style.position = 'fixed';
            panel.style.transform = 'none';
            panel.style.margin = '0';
            panel.style.width = 'min(32rem, calc(100vw - 16px))';
            panel.style.maxHeight = '90vh';
            if (anchorEl && typeof anchorEl.getBoundingClientRect === 'function') {
                const rect = anchorEl.getBoundingClientRect();
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                const panelWidth = Math.min(512, vw - 16);
                const left = Math.max(8, Math.min(rect.left, vw - panelWidth - 8));
                panel.style.left = `${left}px`;
                panel.style.right = 'auto';
                panel.style.top = '8px';
                panel.style.bottom = 'auto';
                // Mede após exibir para posicionar o menu próximo da célula sem sair da tela.
                requestAnimationFrame(() => {
                    const h = panel.getBoundingClientRect().height;
                    let top = rect.top;
                    if (top + h > vh - 8) top = rect.bottom - h;
                    top = Math.max(8, Math.min(top, vh - h - 8));
                    panel.style.top = `${top}px`;
                });
            } else {
                panel.style.left = '50%';
                panel.style.top = '50%';
                panel.style.transform = 'translate(-50%, -50%)';
                panel.style.margin = '0';
            }
        }

        function closeDayModal() {
            document.getElementById('dayModal').classList.add('hidden');
        }

        function toggleSwapInputs() {
            const isChecked = document.getElementById('modalSwapCheck').checked;
            const fields = document.getElementById('modalSwapFields');
            if (isChecked) {
                fields.classList.remove('hidden');
            } else {
                fields.classList.add('hidden');
            }
        }

        function handleFileUpload(event) {
            const files = event.target.files;
            if (!files || files.length === 0) return;

            Array.from(files).forEach(file => {
                const reader = new FileReader();
                reader.onload = function(e) {
                    currentAttachments.push({
                        id: Date.now() + Math.random(),
                        name: file.name,
                        type: file.type,
                        data: e.target.result
                    });
                    renderAttachmentsList();
                };
                reader.readAsDataURL(file);
            });
        }

        function removeAttachment(id) {
            currentAttachments = currentAttachments.filter(a => a.id !== id);
            renderAttachmentsList();
        }

        function renderAttachmentsList() {
            const container = document.getElementById('modalAttachmentsList');
            container.innerHTML = '';

            if (currentAttachments.length === 0) {
                container.innerHTML = `<p class="text-[11px] text-gray-400 italic">Nenhum arquivo anexado a este dia.</p>`;
                return;
            }

            currentAttachments.forEach(att => {
                const item = document.createElement('div');
                item.className = "flex items-center justify-between p-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-xs";

                let icon = 'fa-file';
                if (att.type.startsWith('image/')) icon = 'fa-file-image text-amber-500';
                else if (att.type.startsWith('video/')) icon = 'fa-file-video text-blue-500';
                else if (att.type.startsWith('audio/')) icon = 'fa-file-audio text-purple-500';
                else if (att.type.includes('pdf')) icon = 'fa-file-pdf text-red-500';

                item.innerHTML = `
                    <div class="flex items-center gap-2 truncate max-w-[80%]">
                        <i class="fa-solid ${icon}"></i>
                        <a href="${att.data}" target="_blank" class="truncate font-medium hover:underline">${att.name}</a>
                    </div>
                    <button onclick="removeAttachment(${att.id})" class="text-red-500 hover:text-red-700">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                `;
                container.appendChild(item);
            });
        }

        function saveDayModalData() {
            const note = document.getElementById('modalNoteInput').value;
            const swapActive = document.getElementById('modalSwapCheck').checked;
            const agentOne = document.getElementById('modalSwapAgentOne').value.trim();
            const dateOne = document.getElementById('modalSwapDateOneInput').value;
            const agentTwo = document.getElementById('modalSwapAgentTwo').value.trim();
            const dateTwo = document.getElementById('modalSwapDateTwoInput').value;
            if (swapActive && (!agentOne || !dateOne || !agentTwo || !dateTwo || dateOne === dateTwo)) {
                alert('Informe o nome e a data de plantão dos dois agentes. As duas datas devem ser diferentes.');
                return;
            }

            const extraType = document.getElementById('modalExtraType').value;
            const extraRate = document.getElementById('modalExtraRate').value;
            const extraHours = document.getElementById('modalExtraHours').value;
            const dayOff = document.getElementById('modalDayOffCheck').checked;
            const previousEvent = eventsData[selectedDateStr] || {};
            const previousSwapDate = previousEvent.swap?.otherDate || '';

            // Remove o par de troca anteriormente associado ao dia aberto, se houver.
            if (previousEvent.swap?.active) {
                const oldPartnerKey = previousEvent.swap.otherDate;
                if (oldPartnerKey && eventsData[oldPartnerKey]?.swap?.otherDate === selectedDateStr) {
                    delete eventsData[oldPartnerKey].swap;
                    const partner = eventsData[oldPartnerKey];
                    if (partner && !partner.note && (!partner.extra || partner.extra.type === 'none') && (!partner.attachments || !partner.attachments.length) && partner.dayOff !== true) delete eventsData[oldPartnerKey];
                }
                delete previousEvent.swap;
            }
            // Se alguma das novas datas já pertencia a outra troca, desliga o vínculo antigo.
            [dateOne, dateTwo].filter(Boolean).forEach(newDate => {
                const existing = eventsData[newDate];
                if (existing?.swap?.active) {
                    const oldPartnerKey = existing.swap.otherDate;
                    if (oldPartnerKey && oldPartnerKey !== dateOne && oldPartnerKey !== dateTwo && eventsData[oldPartnerKey]?.swap?.otherDate === newDate) {
                        delete eventsData[oldPartnerKey].swap;
                        const oldPartner = eventsData[oldPartnerKey];
                        if (oldPartner && !oldPartner.note && (!oldPartner.extra || oldPartner.extra.type === 'none') && (!oldPartner.attachments || !oldPartner.attachments.length) && oldPartner.dayOff !== true) delete eventsData[oldPartnerKey];
                    }
                    delete existing.swap;
                }
            });

            // Guarda os dados gerais do dia selecionado sem obrigar a troca a ocorrer nele.
            const selectedEvent = eventsData[selectedDateStr] || {};
            selectedEvent.note = note;
            selectedEvent.dayOff = dayOff;
            selectedEvent.extra = { type: extraType, rate: extraRate, hours: Number(extraHours) || 0 };
            selectedEvent.attachments = currentAttachments;
            eventsData[selectedDateStr] = selectedEvent;

            if (swapActive) {
                // Cada data recebe o nome do agente que trabalhará naquele plantão;
                // ambas ficam destacadas em laranja no calendário.
                const groupId = `swap-${dateOne}-${dateTwo}-${Date.now()}`;
                const assignSwap = (dateKey, agentName, otherDate, otherAgent) => {
                    const ev = eventsData[dateKey] || {};
                    ev.dayOff = false;
                    ev.swap = {
                        active: true,
                        type: 'troca_de_plantao',
                        role: 'working_for',
                        agent: agentName,
                        agentTwo: otherAgent,
                        otherDate,
                        groupId
                    };
                    if (!ev.extra) ev.extra = { type: 'none', rate: '50', hours: 0 };
                    if (!ev.attachments) ev.attachments = [];
                    eventsData[dateKey] = ev;
                };
                assignSwap(dateOne, agentOne, dateTwo, agentTwo);
                assignSwap(dateTwo, agentTwo, dateOne, agentOne);
            }

            // Evita deixar objetos vazios nos dias que foram desvinculados.
            Object.keys(eventsData).forEach(key => {
                const ev = eventsData[key];
                if (ev && !ev.note && (!ev.extra || ev.extra.type === 'none') && (!ev.attachments || !ev.attachments.length) && ev.dayOff !== true && !(ev.swap && ev.swap.active)) delete eventsData[key];
            });

            amtStorage.setItem('amt_events_data', JSON.stringify(eventsData));
            closeDayModal();
            renderApp();
            updateCountdown();
            refreshManagementPanel();
        }

        async function clearDayData() {
            if(eventsData[selectedDateStr]&&!await amtPrevent())return;
            if (eventsData[selectedDateStr]) {
                const linkedSwapDate = eventsData[selectedDateStr].swap?.otherDate || '';
                if (linkedSwapDate && eventsData[linkedSwapDate]?.swap?.otherDate === selectedDateStr) {
                    delete eventsData[linkedSwapDate].swap;
                    const linked = eventsData[linkedSwapDate];
                    if (linked && !linked.note && (!linked.extra || linked.extra.type === 'none') && (!linked.attachments || !linked.attachments.length) && linked.dayOff !== true) delete eventsData[linkedSwapDate];
                }
                delete eventsData[selectedDateStr];
                amtStorage.setItem('amt_events_data', JSON.stringify(eventsData));
            }
            closeDayModal();
            renderApp();
            updateCountdown();
            refreshManagementPanel();
        }

        /* ==========================================================================
           9. MODAL DE CONFIGURAÇÃO DE DATA BASE DA ESCALA
           ========================================================================== */
        function setupSettingsScreen() {
            const moves = [
                ['pdfSettings', 'settingsPdfMount'],
                ['pinSettings', 'settingsPinMount'],
                ['backupSettings', 'settingsBackupMount']
            ];
            moves.forEach(([id, mountId]) => {
                const el = document.getElementById(id), mount = document.getElementById(mountId);
                if (el && mount && el.parentElement !== mount) {
                    el.classList.remove('hidden', 'config-only-tools');
                    el.classList.add('bg-[#F8F5ED]', 'dark:bg-[#211F1B]', 'rounded-2xl', 'border', 'border-gray-200', 'dark:border-gray-700', 'p-4', 'space-y-3');
                    el.style.marginTop = '0';
                    mount.appendChild(el);
                }
            });
            const oldModal = document.getElementById('configModal');
            if (oldModal) oldModal.classList.add('hidden');
        }

        function openConfigModal() {
            setupSettingsScreen();
            document.getElementById('appMain').classList.add('hidden');
            document.getElementById('settingsScreen').classList.remove('hidden');
            const legacyBaseInput = document.getElementById('settingsBaseDateInput'); if (legacyBaseInput) legacyBaseInput.value = baseDutyDate;
            renderSavedScaleConfigs();
            const btn = document.getElementById('btnConfig');
            if (btn) btn.setAttribute('aria-pressed', 'true');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function closeConfigModal() {
            document.getElementById('settingsScreen').classList.add('hidden');
            document.getElementById('appMain').classList.remove('hidden');
            const btn = document.getElementById('btnConfig');
            if (btn) btn.setAttribute('aria-pressed', 'false');
            renderApp();
        }

        function saveConfigBaseDate() {
            const legacyBaseInput = document.getElementById('settingsBaseDateInput'); const val = legacyBaseInput ? legacyBaseInput.value : ''; 
            baseDutyDate = val || '';
            if (val) amtStorage.setItem('amt_base_date', val); else amtStorage.removeItem('amt_base_date');
            renderApp(); updateCountdown();
            alert(val ? 'Escala atualizada.' : 'Data base removida. Escolha uma data para ativar a escala.');
        }

        function updateReportMode(){const mode=document.getElementById('reportMode').value;document.getElementById('reportSingleFields').classList.toggle('hidden',mode!=='single');document.getElementById('reportPeriodFields').classList.toggle('hidden',mode!=='period');document.getElementById('reportCompareFields').classList.toggle('hidden',mode!=='compare');}
        function addReportCompareMonth(){const wrap=document.getElementById('reportCompareMonths');const n=wrap.querySelectorAll('.report-compare-month').length+1;const label=document.createElement('label');label.className='text-xs relative block';label.innerHTML='<span class="block pr-7">Mês '+n+'</span><button type="button" aria-label="Excluir mês da comparação" title="Excluir mês" onclick="removeReportCompareMonth(this)" class="absolute right-0 top-0 h-6 w-6 rounded-full bg-red-600 text-white font-black leading-none hover:bg-red-700">×</button><input type="month" class="report-compare-month mt-1 w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-sm">';wrap.appendChild(label);const input=label.querySelector('input[type=month]');if(input){input.id='reportCompareMonth_'+n;input.classList.add('hidden');const b=document.createElement('button');b.type='button';b.id=input.id+'WheelDisplay';b.className='mt-1 w-full text-left px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-sm text-gray-500';b.textContent='Selecionar mês';b.onclick=()=>openMonthWheel(input);input.insertAdjacentElement('afterend',b);}} function removeReportCompareMonth(button){const wrap=document.getElementById('reportCompareMonths');const labels=[...wrap.querySelectorAll('label')];if(labels.length<=2){alert('A comparação precisa manter pelo menos dois meses.');return;}button.closest('label').remove();[...wrap.querySelectorAll('label')].forEach((label,i)=>{const span=label.querySelector('span');if(span)span.textContent='Mês '+(i+1);});}
        function resetReportFields(){const mode=document.getElementById('reportMode');if(mode)mode.value='';['reportMonth','reportMonthStartRange','reportMonthEnd'].forEach(id=>{const el=document.getElementById(id);if(el){el.value='';if(window.updateMonthInputDisplay)window.updateMonthInputDisplay(el);}});document.querySelectorAll('.report-compare-month').forEach(el=>{el.value='';if(window.updateMonthInputDisplay)window.updateMonthInputDisplay(el);});document.querySelectorAll('#reportOptions input[type=checkbox], #pdfOptions input[type=checkbox]').forEach(el=>{if(el.dataset.defaultChecked==='true')el.checked=true;});const wrap=document.getElementById('reportCompareMonths');if(wrap){const labels=[...wrap.querySelectorAll('label')];labels.slice(2).forEach(x=>x.remove());}updateReportMode();}
        function generateMonthlyPDF() {
            const mode=document.getElementById('reportMode')?.value||'single';let monthKeys=[];
            const validMonth=v=>/^\d{4}-\d{2}$/.test(v||'');
            if(mode==='single'){const v=document.getElementById('reportMonth').value;if(!validMonth(v)){alert('Selecione o mês que deseja consultar.');return;}monthKeys=[v];}
            else if(mode==='period'){const first=document.getElementById('reportMonthStartRange').value,last=document.getElementById('reportMonthEnd').value;if(!validMonth(first)||!validMonth(last)){alert('Selecione o mês inicial e final do período.');return;}if(last<first){alert('O mês final deve ser igual ou posterior ao inicial.');return;}let c=new Date(+first.slice(0,4),+first.slice(5,7)-1,1),e=new Date(+last.slice(0,4),+last.slice(5,7)-1,1);while(c<=e&&monthKeys.length<120){monthKeys.push(c.getFullYear()+'-'+String(c.getMonth()+1).padStart(2,'0'));c.setMonth(c.getMonth()+1);}}
            else {monthKeys=Array.from(document.querySelectorAll('.report-compare-month')).map(x=>x.value).filter(validMonth);monthKeys=[...new Set(monthKeys)].sort();if(monthKeys.length<2){alert('Escolha pelo menos dois meses diferentes para comparar.');return;}}
            if (!window.jspdf || !window.jspdf.jsPDF) { alert('Não foi possível carregar o gerador de PDF. Verifique a conexão com a internet e tente novamente.'); return; }
            const selected=id=>document.getElementById(id)?.checked;const {jsPDF}=window.jspdf;const doc=new jsPDF({unit:'mm',format:'a4',orientation:'portrait'});const pw=doc.internal.pageSize.getWidth(),margin=10;let y=31;
            const profile=JSON.parse(amtStorage.getItem('amt_agent_profile_v35')||'{}');const agent='AGT '+(profile.name||'Servidor não cadastrado');
            doc.setFillColor(18,18,20);doc.rect(0,0,pw,25,'F');doc.setTextColor(255,193,7);doc.setFont('helvetica','bold');doc.setFontSize(14);doc.text('ESCALA AMT EUSÉBIO',margin,10);doc.setTextColor(255,255,255);doc.setFontSize(9);doc.text(agent,margin,18);doc.setFontSize(8);doc.text(monthKeys.length===1?monthKeys[0]:monthKeys[0]+' a '+monthKeys[monthKeys.length-1],pw-margin,18,{align:'right'});doc.setTextColor(25,25,25);
            const line=(txt,bold=false,size=8)=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);const lines=doc.splitTextToSize(String(txt),pw-margin*2);if(y+lines.length*(size*.42)+1.3>285){doc.addPage();y=14;}doc.text(lines,margin,y);y+=lines.length*(size*.42)+1.3;};
            line(mode==='compare'?'RELATÓRIO — COMPARAÇÃO DE MESES':mode==='period'?'RELATÓRIO DE ESCALA — PERÍODO':'RELATÓRIO MENSAL DE ESCALA',true,10);
            let grandExtraShifts=0,grandH50=0,grandH100=0;
            for(const mk of monthKeys){const [yy,mm]=mk.split('-').map(Number),days=new Date(yy,mm,0).getDate();let duty=0,off=0,extraDays=0,extraShifts=0,swaps=countUniqueSwapsInMonth(yy,mm-1),h50=0,h100=0,dutyDates=[],offDates=[];const rows=[];
                for(let d=1;d<=days;d++){const dt=new Date(yy,mm-1,d),key=formatDateKey(dt),ev=eventsData[key]||{},isDuty=isDutyDay(dt);if(isDuty){duty++;dutyDates.push(String(d).padStart(2,'0'));}else{off++;offDates.push(String(d).padStart(2,'0'));}if(ev.extra?.type==='hours'){extraDays++;const h=Number(ev.extra.hours)||0;if(ev.extra.rate==='100')h100+=h;else h50+=h;}if(ev.extra?.type==='shift'){extraShifts++;if(ev.extra.rate==='100')h100+=24;else h50+=24;}if(ev.note||ev.swap?.active||ev.extra?.type==='hours'||ev.extra?.type==='shift')rows.push(`${String(d).padStart(2,'0')}: ${ev.extra?.type==='hours'?'Extra '+(Number(ev.extra.hours)||0)+'h '+(ev.extra.rate||'50')+'% ':''}${ev.extra?.type==='shift'?'Plantão extra 24h ':''}${ev.swap?.active?'Troca com '+(ev.swap.agent||'agente não informado')+' ':''}${ev.note?'Obs.: '+ev.note:''}`.trim());}
                grandExtraShifts+=extraShifts;grandH50+=h50;grandH100+=h100;
                line(new Date(yy,mm-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}).toUpperCase(),true,9);
                if(selected('pdfOptDuty'))line(`Plantões: ${duty} dia(s) — ${dutyDates.length?dutyDates.join(', '):'nenhum'}`);if(selected('pdfOptOff'))line(`Folgas: ${off} dia(s) — ${offDates.length?offDates.join(', '):'nenhuma'}`);if(selected('pdfOptExtras'))line(`Dias com hora extra: ${extraDays} | Plantões extras 24h: ${extraShifts} | Horas 50%: ${h50}h | Horas 100%: ${h100}h`);if(selected('pdfOptSwaps'))line(`Trocas de plantão: ${swaps}`);if(selected('pdfOptDetails')&&rows.length)rows.forEach(r=>line(r,false,7));y+=1;
            }
            line('TOTAIS GERAIS DO RELATÓRIO',true,10);
            line(`Total de plantões extras: ${grandExtraShifts}`,true,9);
            line(`Total de horas extras 50%: ${grandH50}h`,true,9);
            line(`Total de horas extras 100%: ${grandH100}h`,true,9);
            line('Relatório gerado pelo aplicativo Escala AMT Eusébio.',false,7);doc.save('Relatorio_AMT_Eusebio_'+monthKeys[0]+(monthKeys.length>1?'_comparacao_'+monthKeys[monthKeys.length-1]:'')+'.pdf');
            resetReportFields();
        }

        /* =====================================================================
           10. FERRAMENTAS: painel, pesquisa, backup, lembretes, PIN e PWA
           ===================================================================== */
        function refreshManagementPanel() {
            const today = new Date(); today.setHours(0,0,0,0);
            const todayDuty = isDutyDay(today);
            const next = new Date(today);
            let guard = 0;
            while (!isDutyDay(next) && guard++ < 8) next.setDate(next.getDate()+1);
            if (document.getElementById('dashToday')) document.getElementById('dashToday').textContent = todayDuty ? 'Plantão previsto' : 'Folga prevista';
            if (document.getElementById('dashNext')) document.getElementById('dashNext').textContent = formatDateFormatted(next);
            const prefix = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-`;
            const monthEvents = Object.entries(eventsData).filter(([k,v]) => k.startsWith(prefix) && v && (v.note || (v.swap && v.swap.active) || (v.extra && v.extra.type && v.extra.type !== 'none') || (v.attachments && v.attachments.length)));
            let hours = 0, extraShifts = 0;
            Object.entries(eventsData).filter(([k])=>k.startsWith(prefix)).forEach(([k,v])=>{ if(v.extra?.type==='hours') hours += Number(v.extra.hours)||0; if(v.extra?.type==='shift') extraShifts++; });
            const swaps = countUniqueSwapsInMonth(today.getFullYear(), today.getMonth());
            if (document.getElementById('dashRecords')) document.getElementById('dashRecords').textContent = monthEvents.length;
            if (document.getElementById('dashHours')) document.getElementById('dashHours').textContent = `${hours} h`;
            if (document.getElementById('statsSummary')) document.getElementById('statsSummary').innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-4 gap-2"><div><b>${hours} h</b><br><span class="text-xs">Horas extras registradas</span></div><div><b>${extraShifts}</b><br><span class="text-xs">Plantões extras</span></div><div><b>${swaps}</b><br><span class="text-xs">Trocas registradas</span></div><div><b>${Object.keys(eventsData).length}</b><br><span class="text-xs">Dias com registros</span></div></div>`;
            if (document.getElementById('pinStatus')) document.getElementById('pinStatus').textContent = amtPinConfig() ? 'PIN configurado neste navegador.' : 'Nenhum PIN configurado.';
            if (document.getElementById('reminderStatus')) document.getElementById('reminderStatus').textContent = amtStorage.getItem('amt_reminders') ? 'Lembretes ativados neste dispositivo.' : 'Lembretes desativados.';
        }

        function searchRecords() {
            const query=(document.getElementById('recordSearch')?.value||'').trim().toLocaleLowerCase('pt-BR');
            const root=document.getElementById('recordResults');if(!root)return;root.innerHTML='';
            if(!query){root.innerHTML='<p class="text-gray-500">Digite um termo para pesquisar registros.</p>';return;}
            const matches=Object.entries(eventsData||{}).filter(([key,e])=>{
                const parts=[key,e?.note||'',e?.swap?.agent||'',...(e?.attachments||[]).map(a=>a.name||a.filename||'')];
                return parts.join(' ').toLocaleLowerCase('pt-BR').includes(query);
            }).sort((a,b)=>b[0].localeCompare(a[0]));
            if(!matches.length){root.innerHTML='<p class="text-gray-500">Nenhum registro encontrado.</p>';return;}
            matches.forEach(([key,e])=>{const row=document.createElement('button');row.type='button';row.className='w-full text-left rounded-xl border border-gray-200 dark:border-gray-700 p-3 hover:border-amber-500';const [y,m,d]=key.split('-');row.innerHTML=`<strong>${d}/${m}/${y}</strong><span class="block text-xs text-gray-500 mt-1">${(e.note||'').replace(/[<>]/g,'').slice(0,180)||'Registro no calendário'}${e.swap?.agent?' · Agente: '+String(e.swap.agent).replace(/[<>]/g,''):''}</span>`;row.onclick=()=>{const dt=new Date(+y,+m-1,+d);currentDate=new Date(+y,+m-1,1);currentView='month';renderApp();openDayModal(dt);};root.appendChild(row);});
        }
        function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
        // Backup completo ZIP sem dependência externa: funciona também offline.
        const zipTextEncoder = new TextEncoder();
        const zipTextDecoder = new TextDecoder('utf-8');
        const zipCrcTable = (()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}return t;})();
        function zipCrc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=zipCrcTable[(c^b)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
        function zipConcat(parts){const size=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(size);let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;}
        function zipU16(v){const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,v,true);return a;}
        function zipU32(v){const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,v>>>0,true);return a;}
        function makeStoredZip(files){
            const locals=[],centrals=[];let offset=0;
            for(const file of files){const name=zipTextEncoder.encode(file.name),data=file.data instanceof Uint8Array?file.data:new Uint8Array(file.data),crc=zipCrc32(data);
                const local=zipConcat([zipU32(0x04034b50),zipU16(20),zipU16(0x0800),zipU16(0),zipU16(0),zipU16(0),zipU32(crc),zipU32(data.length),zipU32(data.length),zipU16(name.length),zipU16(0),name,data]);locals.push(local);
                centrals.push(zipConcat([zipU32(0x02014b50),zipU16(20),zipU16(20),zipU16(0x0800),zipU16(0),zipU16(0),zipU16(0),zipU32(crc),zipU32(data.length),zipU32(data.length),zipU16(name.length),zipU16(0),zipU16(0),zipU16(0),zipU16(0),zipU32(0),zipU32(offset),name]));offset+=local.length;
            }
            const central=zipConcat(centrals),body=zipConcat(locals),end=zipConcat([zipU32(0x06054b50),zipU16(0),zipU16(0),zipU16(files.length),zipU16(files.length),zipU32(central.length),zipU32(body.length),zipU16(0)]);
            return zipConcat([body,central,end]);
        }
        function readStoredZip(buffer){
            const bytes=new Uint8Array(buffer),view=new DataView(buffer);let eocd=-1;
            for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65558);i--){if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}}
            if(eocd<0)throw new Error('O arquivo não contém uma estrutura ZIP válida.');
            const count=view.getUint16(eocd+10,true),centralOffset=view.getUint32(eocd+16,true);let pos=centralOffset;const out={};
            for(let i=0;i<count;i++){
                if(view.getUint32(pos,true)!==0x02014b50)throw new Error('Índice ZIP inválido.');
                const method=view.getUint16(pos+10,true),crc=view.getUint32(pos+16,true),size=view.getUint32(pos+24,true),nameLen=view.getUint16(pos+28,true),extraLen=view.getUint16(pos+30,true),commentLen=view.getUint16(pos+32,true),localOffset=view.getUint32(pos+42,true);
                const name=zipTextDecoder.decode(bytes.slice(pos+46,pos+46+nameLen));if(method!==0)throw new Error('Este ZIP usa compressão não compatível. Gere o backup pelo próprio aplicativo.');
                if(view.getUint32(localOffset,true)!==0x04034b50)throw new Error('Arquivo interno ZIP inválido.');
                const localName=view.getUint16(localOffset+26,true),localExtra=view.getUint16(localOffset+28,true),dataStart=localOffset+30+localName+localExtra,data=bytes.slice(dataStart,dataStart+size);
                if(data.length!==size||zipCrc32(data)!==crc)throw new Error('Um arquivo do backup está corrompido: '+name);
                out[name]=data;pos+=46+nameLen+extraLen+commentLen;
            }
            return out;
        }
        async function getPaystubRecords(){return await window.amtPDFs();}
        async function resetAppData() {
            if (amtPinConfig() && !await amtPinAuthorize()) return;
            const confirmed = confirm('Tem certeza que deseja resetar o aplicativo? Todos os registros, cadastro, configurações e PIN salvos neste dispositivo serão apagados. Esta ação não pode ser desfeita.');
            if (!confirmed) return;
            const secondConfirm = confirm('Confirma a exclusão de todos os dados da Escala AMT e o retorno à tela inicial para um novo cadastro?');
            if (!secondConfirm) return;
            if(!await amtPrevent())return;
            try {
                amtStorage.keys().filter(key => key.startsWith('amt_')).forEach(key => amtStorage.removeItem(key));
                amtStorage.removeItem('amt_agent_profile_v35');
                await amtStorage.flush(); await amtClearPDFs();
                Object.keys(window.localStorage).filter(k=>k.startsWith('amt_')).forEach(k=>window.localStorage.removeItem(k));
            } catch (error) {
                alert('Não foi possível apagar todos os dados. Verifique as permissões do navegador e tente novamente.');
                return;
            }
            alert('Aplicativo resetado. Você será levado à tela inicial para fazer um novo cadastro.');
            window.location.reload();
        }

        async function enableReminders() {
            if (!('Notification' in window)) { alert('Este navegador não oferece suporte a notificações.'); return; }
            const permission=await Notification.requestPermission(); if(permission!=='granted'){ alert('Permissão para notificações não concedida.'); return; }
            amtStorage.setItem('amt_reminders',document.getElementById('reminderHours').value); refreshManagementPanel(); checkReminder(); alert('Lembretes ativados. O aviso depende das permissões e de o navegador/sistema permitir notificações em segundo plano; isso não configura o alarme nativo do celular.');
        }
        function checkReminder() {
            if (!('Notification' in window) || Notification.permission!=='granted' || !amtStorage.getItem('amt_reminders')) return;
            const hours=Number(amtStorage.getItem('amt_reminders'))||3; const now=new Date(); const target=new Date(now); target.setHours(6,0,0,0); if(target<=now) target.setDate(target.getDate()+1);
            if (isDutyDay(target) && (target-now)<=hours*3600000 && (target-now)>=(hours-1/60)*3600000) { const key='amt_notified_'+formatDateKey(target); if(!amtStorage.getItem(key)){ new Notification('Escala AMT Eusébio',{body:`Seu plantão está previsto para ${formatDateFormatted(target)} às 06:00.`, vibrate:[300,150,300], tag:'amt-plantao'}); amtStorage.setItem(key,'1'); } }
        }
        /* ==========================================================================
           10. UTILITÁRIOS DE FORMATO DE DATA
           ========================================================================== */
        function formatDateKey(dateObj) {
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        function formatDateFormatted(dateObj) {
            if (!dateObj) return '--/--/----';
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = dateObj.getFullYear();
            return `${day}/${month}/${year}`;
        }
    