using System.Text.Json.Serialization;
using InvoiceApp.Api;
using InvoiceApp.Api.Auth;
using InvoiceApp.Domain;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.Configure<DemoUsersOptions>(builder.Configuration);
builder.Services.AddSingleton<SessionStore>();
// Keep this a singleton: ApprovalService's decision gate is per repository instance, so FR-004 under simultaneous
// requests holds only while every request shares this one. A database-backed repository would need optimistic
// concurrency instead (specs/001-approval-limits/research.md R6).
builder.Services.AddSingleton<IInvoiceRepository, InMemoryInvoiceRepository>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<ApprovalService>();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseMiddleware<SessionAuthMiddleware>();
app.MapControllers();

app.Run();
