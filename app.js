const state = {
  metrics: [
    {
      label: "Active Referrals",
      value: 32,
      trend: "+18%",
      trendDirection: "positive",
      sublabel: "vs last quarter",
    },
    {
      label: "Conversion Rate",
      value: "42%",
      trend: "+6%",
      trendDirection: "positive",
      sublabel: "Qualified to won",
    },
    {
      label: "Average Deal Value",
      value: "$18.4k",
      trend: "-4%",
      trendDirection: "negative",
      sublabel: "Rolling 90 days",
    },
    {
      label: "Partner NPS",
      value: "72",
      trend: "+2",
      trendDirection: "positive",
      sublabel: "Surveyed quarterly",
    },
  ],
  funnel: {
    quarter: [
      { stage: "Introduced", total: 80, ratio: 100 },
      { stage: "Qualified", total: 56, ratio: 70 },
      { stage: "Engaged", total: 36, ratio: 45 },
      { stage: "Contract Out", total: 22, ratio: 28 },
      { stage: "Won", total: 14, ratio: 18 },
    ],
    month: [
      { stage: "Introduced", total: 28, ratio: 100 },
      { stage: "Qualified", total: 18, ratio: 64 },
      { stage: "Engaged", total: 11, ratio: 39 },
      { stage: "Contract Out", total: 7, ratio: 25 },
      { stage: "Won", total: 4, ratio: 14 },
    ],
  },
  referrals: [
    {
      id: "RF-1024",
      client: "Simone Baker",
      referringAgent: "Alex Lopez",
      receivingAgent: "Priya Singh",
      status: "Qualified",
      value: 19000,
      updatedAt: "2d",
      source: "Inbound",
      region: "West",
    },
    {
      id: "RF-1025",
      client: "Mason Carter",
      referringAgent: "Devon Miles",
      receivingAgent: "Jordan Kim",
      status: "Introduced",
      value: 12000,
      updatedAt: "4h",
      source: "Outbound",
      region: "South",
    },
    {
      id: "RF-1026",
      client: "Aria Moore",
      referringAgent: "Priya Singh",
      receivingAgent: "Taylor Reed",
      status: "Won",
      value: 38500,
      updatedAt: "1d",
      source: "Inbound",
      region: "North",
    },
    {
      id: "RF-1027",
      client: "Noah Chen",
      referringAgent: "Alex Lopez",
      receivingAgent: "Maya Patel",
      status: "Contract Out",
      value: 24500,
      updatedAt: "5d",
      source: "Event",
      region: "West",
    },
    {
      id: "RF-1028",
      client: "Liam Rivera",
      referringAgent: "Maya Patel",
      receivingAgent: "Jordan Kim",
      status: "Engaged",
      value: 22100,
      updatedAt: "3d",
      source: "Inbound",
      region: "Midwest",
    },
  ],
  agents: [
    {
      id: "AG-201",
      name: "Priya Singh",
      company: "Singh & Co Realty",
      region: "West Coast",
      specialty: "Luxury Buyers",
      lastReferral: "3d ago",
      referralsSent: 22,
      referralsReceived: 18,
      avatar: "PS",
    },
    {
      id: "AG-202",
      name: "Jordan Kim",
      company: "UrbanNest Brokers",
      region: "Pacific Northwest",
      specialty: "Relocations",
      lastReferral: "12h ago",
      referralsSent: 16,
      referralsReceived: 20,
      avatar: "JK",
    },
    {
      id: "AG-203",
      name: "Alex Lopez",
      company: "Lopez Collective",
      region: "Southwest",
      specialty: "Investors",
      lastReferral: "1w ago",
      referralsSent: 31,
      referralsReceived: 9,
      avatar: "AL",
    },
    {
      id: "AG-204",
      name: "Maya Patel",
      company: "Patel Premier Homes",
      region: "Southeast",
      specialty: "Luxury Sellers",
      lastReferral: "4d ago",
      referralsSent: 12,
      referralsReceived: 14,
      avatar: "MP",
    },
  ],
  activities: [
    {
      id: "AC-1",
      description: "Referral RF-1027 moved to Contract Out",
      timestamp: "18 minutes ago",
      owner: "You",
    },
    {
      id: "AC-2",
      description: "Follow-up call scheduled with Simone Baker",
      timestamp: "1 hour ago",
      owner: "Alex Lopez",
    },
    {
      id: "AC-3",
      description: "New referral added for Liam Rivera",
      timestamp: "Yesterday",
      owner: "Jordan Kim",
    },
  ],
  tasks: [
    {
      id: "TS-1",
      title: "Send intro email to receiving agent",
      description: "Share client goals and warm connection details with Taylor.",
      status: "Due soon",
      due: "Tomorrow",
      assignee: "You",
    },
    {
      id: "TS-2",
      title: "Update referral agreement",
      description: "Review revenue share percentages with UrbanNest Brokers.",
      status: "In progress",
      due: "Jun 18",
      assignee: "Priya Singh",
    },
    {
      id: "TS-3",
      title: "Survey partner satisfaction",
      description: "Send quarterly NPS survey to top 20 referral partners.",
      status: "Planned",
      due: "Jun 22",
      assignee: "RevOps",
    },
  ],
};

const selectors = {
  metricCards: document.getElementById("metricCards"),
  conversionGraph: document.getElementById("conversionGraph"),
  funnelFilter: document.getElementById("funnelFilter"),
  activityFeed: document.getElementById("activityFeed"),
  referralTable: document.getElementById("referralTable"),
  statusFilter: document.getElementById("statusFilter"),
  sourceFilter: document.getElementById("sourceFilter"),
  regionFilter: document.getElementById("regionFilter"),
  agentGrid: document.getElementById("agentGrid"),
  pipelineBoard: document.getElementById("pipelineBoard"),
  taskList: document.getElementById("taskList"),
  globalSearch: document.getElementById("globalSearch"),
  sectionTitle: document.getElementById("sectionTitle"),
  navButtons: document.querySelectorAll(".nav-btn"),
  sections: document.querySelectorAll("[data-section]"),
  modal: document.getElementById("modal"),
  modalForm: document.getElementById("modalForm"),
  modalTitle: document.getElementById("modalTitle"),
  newReferralBtn: document.getElementById("newReferralBtn"),
  addTaskBtn: document.getElementById("addTaskBtn"),
  taskTemplate: document.getElementById("taskTemplate"),
};

function renderMetrics() {
  selectors.metricCards.innerHTML = state.metrics
    .map(
      (metric) => `
        <div class="metric-card">
          <div class="metric-card__label">${metric.label}</div>
          <div class="metric-card__value">${metric.value}</div>
          <div class="metric-card__trend metric-card__trend--${metric.trendDirection} ${
        metric.trendDirection === "positive" ? "is-positive" : "is-negative"
      }">
            ${metric.trend}
            <span class="muted">${metric.sublabel}</span>
          </div>
        </div>
      `
    )
    .join("");
}

function renderFunnel(range = "quarter") {
  const steps = state.funnel[range];
  selectors.conversionGraph.innerHTML = steps
    .map(
      (step) => `
        <div class="conversion-step">
          <div class="conversion-step__header">
            <strong>${step.stage}</strong>
            <span class="muted">${step.total} referrals</span>
          </div>
          <div class="progress-bar">
            <div class="progress-bar__fill" style="width: ${step.ratio}%"></div>
          </div>
        </div>
      `
    )
    .join("");
}

function renderActivity() {
  selectors.activityFeed.innerHTML = state.activities
    .map(
      (activity) => `
        <li class="activity-item">
          <div>${activity.description}</div>
          <div class="activity-item__meta">
            <span>${activity.owner}</span>
            <span>${activity.timestamp}</span>
          </div>
        </li>
      `
    )
    .join("");
}

function renderReferralFilters() {
  const statuses = new Set(["all", ...state.referrals.map((r) => r.status)]);
  const sources = new Set(["all", ...state.referrals.map((r) => r.source)]);

  selectors.statusFilter.innerHTML = Array.from(statuses)
    .map((status) => `<option value="${status}">${status}</option>`)
    .join("");

  selectors.sourceFilter.innerHTML = Array.from(sources)
    .map((source) => `<option value="${source}">${source}</option>`)
    .join("");
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function renderReferralTable({ status = "all", source = "all", query = "" } = {}) {
  const rows = state.referrals
    .filter((referral) =>
      [
        referral.client,
        referral.referringAgent,
        referral.receivingAgent,
        referral.status,
        referral.id,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase())
    )
    .filter((referral) => (status === "all" ? true : referral.status === status))
    .filter((referral) => (source === "all" ? true : referral.source === source))
    .map(
      (referral) => `
        <tr>
          <td>
            <div class="table-cell">
              <strong>${referral.client}</strong>
              <div class="muted">${referral.id}</div>
            </div>
          </td>
          <td>${referral.referringAgent}</td>
          <td>${referral.receivingAgent}</td>
          <td><span class="status-pill" data-status="${referral.status.toLowerCase()}">${
        referral.status
      }</span></td>
          <td>${formatCurrency(referral.value)}</td>
          <td>${referral.updatedAt} ago</td>
        </tr>
      `
    )
    .join("");

  selectors.referralTable.innerHTML = rows || `
    <tr>
      <td colspan="6" class="muted">No referrals match the current filters.</td>
    </tr>
  `;
}

function renderRegionFilter() {
  const regions = new Set(["all", ...state.agents.map((agent) => agent.region)]);
  selectors.regionFilter.innerHTML = Array.from(regions)
    .map((region) => `<option value="${region}">${region}</option>`)
    .join("");
}

function renderAgents({ region = "all", query = "" } = {}) {
  selectors.agentGrid.innerHTML = state.agents
    .filter((agent) =>
      [agent.name, agent.company, agent.region, agent.specialty]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase())
    )
    .filter((agent) => (region === "all" ? true : agent.region === region))
    .map(
      (agent) => `
        <article class="agent-card">
          <div class="agent-card__header">
            <div class="agent-card__avatar">${agent.avatar}</div>
            <div>
              <strong>${agent.name}</strong>
              <div class="muted">${agent.company}</div>
            </div>
          </div>
          <div class="agent-card__stats">
            <span>${agent.region}</span>
            <span>${agent.specialty}</span>
          </div>
          <div class="agent-card__stats">
            <span>Sent: ${agent.referralsSent}</span>
            <span>Received: ${agent.referralsReceived}</span>
          </div>
          <div class="muted">Last referral ${agent.lastReferral}</div>
          <div class="agent-card__actions">
            <button class="ghost-btn">View Profile</button>
            <button class="primary-btn">Start Referral</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderPipeline({ query = "" } = {}) {
  const groups = state.referrals.reduce((acc, referral) => {
    const key = referral.status;
    acc[key] = acc[key] || [];
    acc[key].push(referral);
    return acc;
  }, {});

  const filtered = Object.entries(groups).map(([status, referrals]) => [
    status,
    referrals.filter((referral) =>
      [
        referral.client,
        referral.referringAgent,
        referral.receivingAgent,
        referral.status,
        referral.id,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase())
    ),
  ]);

  selectors.pipelineBoard.innerHTML = filtered
    .map(([status, referrals]) => `
      <section class="kanban-column">
        <header class="kanban-column__header">
          <strong>${status}</strong>
          <span class="kanban-column__count">${referrals.length}</span>
        </header>
        ${
          referrals.length
            ? referrals
                .map(
                  (referral) => `
                      <article class="kanban-card">
                        <strong>${referral.client}</strong>
                        <div class="kanban-card__meta">
                          <span>${referral.receivingAgent}</span>
                          <span>${formatCurrency(referral.value)}</span>
                        </div>
                      </article>
                    `
                )
                .join("")
            : `<div class="muted">No referrals in this stage.</div>`
        }
      </section>
    `)
    .join("");
}

function renderTasks() {
  selectors.taskList.innerHTML = state.tasks
    .map((task) => {
      const taskNode = selectors.taskTemplate.content.cloneNode(true);
      taskNode.querySelector(".task-card__title").textContent = task.title;
      taskNode.querySelector(".task-card__status").textContent = task.status;
      taskNode.querySelector(".task-card__description").textContent = task.description;
      taskNode.querySelector(".task-card__due").textContent = task.due;
      taskNode.querySelector(".task-card__assignee").textContent = task.assignee;
      return taskNode;
    })
    .reduce((fragment, node) => {
      fragment.appendChild(node);
      return fragment;
    }, document.createDocumentFragment());
}

function setSection(sectionId) {
  selectors.sections.forEach((section) => {
    section.classList.toggle("is-hidden", section.id !== sectionId);
  });

  selectors.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.section === sectionId);
  });

  const titles = {
    dashboard: "Dashboard",
    referrals: "Referrals",
    agents: "Agent Network",
    pipeline: "Pipeline",
    tasks: "Tasks",
  };
  selectors.sectionTitle.textContent = titles[sectionId] || "Dashboard";
}

function openModal({ title, fields, onSubmit }) {
  selectors.modalTitle.textContent = title;
  selectors.modalForm.innerHTML = fields
    .map(
      (field) => `
        <div class="form__group">
          <label for="${field.id}">${field.label}</label>
          ${(() => {
            if (field.type === "textarea") {
              return `<textarea id="${field.id}" name="${field.id}" placeholder="${field.placeholder || ""}"></textarea>`;
            }
            if (field.type === "select") {
              const options = field.options
                .map((option) => `<option value="${option}">${option}</option>`)
                .join("");
              return `<select id="${field.id}" name="${field.id}">${options}</select>`;
            }
            return `<input id="${field.id}" name="${field.id}" type="${field.type}" placeholder="${field.placeholder || ""}" />`;
          })()}
        </div>
      `
    )
    .join("");

  const handleSubmit = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    onSubmit(payload);
    closeModal();
  };

  selectors.modalForm.addEventListener("submit", handleSubmit, { once: true });
  selectors.modal.classList.add("is-visible");
  selectors.modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  selectors.modal.classList.remove("is-visible");
  selectors.modal.setAttribute("aria-hidden", "true");
}

function initializeEventListeners() {
  selectors.navButtons.forEach((button) => {
    button.addEventListener("click", () => setSection(button.dataset.section));
  });

  selectors.funnelFilter.addEventListener("change", (event) => {
    renderFunnel(event.target.value);
  });

  selectors.statusFilter.addEventListener("change", () => {
    renderReferralTable({
      status: selectors.statusFilter.value,
      source: selectors.sourceFilter.value,
      query: selectors.globalSearch.value,
    });
  });

  selectors.sourceFilter.addEventListener("change", () => {
    renderReferralTable({
      status: selectors.statusFilter.value,
      source: selectors.sourceFilter.value,
      query: selectors.globalSearch.value,
    });
  });

  selectors.regionFilter.addEventListener("change", () => {
    renderAgents({
      region: selectors.regionFilter.value,
      query: selectors.globalSearch.value,
    });
  });

  selectors.globalSearch.addEventListener("input", (event) => {
    const query = event.target.value;
    renderReferralTable({
      status: selectors.statusFilter.value,
      source: selectors.sourceFilter.value,
      query,
    });
    renderAgents({ region: selectors.regionFilter.value, query });
    renderPipeline({ query });
  });

  selectors.newReferralBtn.addEventListener("click", () => {
    openModal({
      title: "Create Referral",
      fields: [
        { id: "client", label: "Client Name", type: "text", placeholder: "Jane Doe" },
        {
          id: "referringAgent",
          label: "Referring Agent",
          type: "text",
          placeholder: "Alex Lopez",
        },
        {
          id: "receivingAgent",
          label: "Receiving Agent",
          type: "text",
          placeholder: "Priya Singh",
        },
        {
          id: "status",
          label: "Status",
          type: "select",
          options: ["Introduced", "Qualified", "Engaged", "Contract Out", "Won", "Lost"],
        },
        {
          id: "value",
          label: "Projected Value",
          type: "number",
          placeholder: "18000",
        },
        {
          id: "notes",
          label: "Notes",
          type: "textarea",
          placeholder: "Share context, timeline, and client goals",
        },
      ],
      onSubmit: (payload) => {
        console.table(payload);
      },
    });
  });

  selectors.addTaskBtn.addEventListener("click", () => {
    openModal({
      title: "Add Task",
      fields: [
        { id: "title", label: "Task Title", type: "text", placeholder: "Follow up with agent" },
        {
          id: "assignee",
          label: "Assignee",
          type: "text",
          placeholder: "Jordan Kim",
        },
        { id: "due", label: "Due Date", type: "date" },
        {
          id: "description",
          label: "Description",
          type: "textarea",
          placeholder: "Outline the next steps and expectations",
        },
      ],
      onSubmit: (payload) => {
        console.table(payload);
      },
    });
  });

  selectors.modal.addEventListener("click", (event) => {
    if (event.target.matches("[data-modal-close]")) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
    }
  });
}

function initialize() {
  renderMetrics();
  renderFunnel();
  renderActivity();
  renderReferralFilters();
  renderReferralTable();
  renderRegionFilter();
  renderAgents();
  renderPipeline();
  renderTasks();
  initializeEventListeners();
}

initialize();
